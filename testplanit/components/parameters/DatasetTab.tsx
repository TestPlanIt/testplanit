"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AssignSharedDatasetDialog } from "@/components/parameters/AssignSharedDatasetDialog";
import { DatasetCell } from "@/components/parameters/DatasetCell";
import { DatasetRowActions } from "@/components/parameters/DatasetRowActions";
import { PasteCsvDialog } from "@/components/parameters/PasteCsvDialog";
import { SheetEditingContext } from "@/components/parameters/ConfigureParametersSheet";
import { SortableDatasetRow } from "@/components/parameters/SortableDatasetRow";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardPaste,
  GripVertical,
  Loader2,
  Lock,
  MoreVertical,
  Plus,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Link, useRouter } from "~/lib/navigation";
import {
  buildRowSchemaFromParameters,
  type ParameterShape,
} from "~/lib/schemas/datasetRowSchema";
import { applyMapping } from "~/lib/utils/datasetMapping";

interface ParameterRecord {
  id: number;
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  sensitive: boolean;
  required: boolean;
  allowedValuesJson?: unknown;
  lookupAllowedValues?: string[];
}

interface DatasetRowRecord {
  id: number;
  label: string | null;
  rowIndex: number;
  valuesJson: Record<string, unknown> | null;
}

interface DatasetRecord {
  id: number;
  rows: DatasetRowRecord[];
}

/**
 * Operating mode for `DatasetTab`.
 *
 * - undefined (default): the per-case "owner dataset" surface — fetches
 *   `/api/repository/cases/{caseId}/dataset`, PATCHes individual cells,
 *   and bulk-deletes rows via the per-case API. PARAM-07 invariant
 *   keeps this byte-for-byte backwards compatible.
 * - "shared-editor": rows + parameters are supplied by the parent and
 *   edits are buffered locally. Cell commits, label edits, add-row,
 *   drag-reorder, and bulk-delete all flow through `onRowsChange` /
 *   `onParametersChange` — no API calls. The parent owns the explicit
 *   Save commit boundary (CONTEXT Amendment B).
 * - "shared-readonly": rows + parameters are supplied by the parent.
 *   Every edit affordance is hidden or disabled. Used to view
 *   historical versions of a shared dataset.
 */
export type DatasetTabMode = "shared-editor" | "shared-readonly";

export interface DatasetTabRow {
  /**
   * Local identifier — for shared mode this is a parent-assigned
   * synthetic id (typically negative or a UUID-derived integer) that
   * disambiguates rows during drag-reorder. For owner-dataset mode this
   * is the real `DataSetRow.id`.
   */
  id: number;
  label: string | null;
  rowIndex: number;
  valuesJson: Record<string, unknown> | null;
}

export interface DatasetTabProps {
  caseId: number;
  projectId: number;
  parameters: ParameterRecord[];
  /**
   * Plan 02-05 wires this to open the multi-step CSV import wizard. In
   * Plan 02-04 this is an optional prop — if omitted, the Import CSV
   * button is rendered but a no-op until 02-05 lands.
   */
  onOpenImportWizard?: () => void;
  /**
   * Optional operating mode. When omitted the per-case (owner-dataset)
   * code path is used — see `DatasetTabMode` for the alternatives.
   */
  mode?: DatasetTabMode;
  /**
   * Required when `mode` is set. Controlled-mode rows.
   */
  rows?: DatasetTabRow[];
  /**
   * Required when `mode === "shared-editor"`. Called whenever the user
   * makes a change that should land in the parent's buffered state.
   */
  onRowsChange?: (rows: DatasetTabRow[]) => void;
  /**
   * Optional in shared-editor mode for parameter-schema edits (column
   * add/remove/rename). Reserved for future use; today the dataset
   * editor pages do not author column schemas — they inherit them.
   */
  onParametersChange?: (parameters: ParameterRecord[]) => void;
}

interface EditCellState {
  rowId: number;
  columnId: string;
}

const DRAG_COLUMN_ID = "__drag";
const SELECT_COLUMN_ID = "__select";
const LABEL_COLUMN_ID = "__label";
const RESULT_COLUMN_ID = "__lastResult";

interface LastResultEntry {
  iterationId: number;
  rowIndex: number;
  runId: number;
  status: {
    id: number;
    name: string;
    isSuccess: boolean;
    isFailure: boolean;
    isCompleted: boolean;
    systemName: string | null;
    color?: { value: string } | null;
  };
}

/**
 * Surface D — the dataset spreadsheet inside the ConfigureParametersSheet.
 *
 * Implements UI-SPEC D plus RESEARCH HOW Q4 canonical recipe:
 *   - State-outside-table: editCell + draftValue + cellErrors Map
 *   - Type dispatch lives in DatasetCell.tsx (RESEARCH HOW Q4)
 *   - Drag-handle column ONLY carries listeners (Pitfall 3)
 *   - PointerSensor + KeyboardSensor both registered (Pitfall 9)
 *   - No virtualization (Pitfall 5)
 *   - Pre-flight Zod validation per cell before PATCH
 */
export function DatasetTab({
  caseId,
  projectId,
  parameters,
  onOpenImportWizard,
  mode,
  rows: controlledRows,
  onRowsChange,
  onParametersChange,
}: DatasetTabProps) {
  const isShared = mode === "shared-editor" || mode === "shared-readonly";
  const isReadOnly = mode === "shared-readonly";
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");
  const tSearchResults = useTranslations("search.results");
  const queryClient = useQueryClient();
  const router = useRouter();
  const { setEditingCell } = useContext(SheetEditingContext);

  // ---------- Surface F: "Last result" cross-link column ----------
  // Cheap gate: only render the trailing column when this case has run
  // history. In shared mode the dataset is project-scoped (no caseId
  // semantics), so the "last result" cross-link is meaningless and the
  // queries are skipped entirely to avoid hitting the API with the
  // caller-supplied placeholder caseId.
  const { data: runHistoryCount } = useClientQueries(schema).testRunCases.useCount(
    { where: { repositoryCaseId: caseId } },
    { enabled: !isShared }
  );
  const caseHasRunHistory = !isShared && (runHistoryCount ?? 0) > 0;

  const { data: lastResultsRaw } = useClientQueries(schema).testRunCaseIteration.useFindMany(
    {
      where: {
        testRunCase: { repositoryCaseId: caseId },
        isDeleted: false,
        statusId: { not: null },
      },
      include: {
        status: {
          select: {
            id: true,
            name: true,
            isSuccess: true,
            isFailure: true,
            isCompleted: true,
            systemName: true,
            color: { select: { value: true } },
          },
        },
        testRunCase: { select: { testRunId: true } },
      },
      orderBy: { completedAt: "desc" },
    },
    { enabled: caseHasRunHistory }
  );

  // Build a map of rowIndex → most-recent iteration result. Query is ordered
  // desc by completedAt, so the first occurrence of any rowIndex wins.
  const lastResultByRowIndex = useMemo(() => {
    const map = new Map<number, LastResultEntry>();
    const list = (lastResultsRaw ?? []) as Array<{
      id: number;
      rowIndex: number;
      status: LastResultEntry["status"] | null;
      testRunCase: { testRunId: number };
    }>;
    for (const it of list) {
      if (!it.status) continue;
      if (map.has(it.rowIndex)) continue;
      map.set(it.rowIndex, {
        iterationId: it.id,
        rowIndex: it.rowIndex,
        runId: it.testRunCase.testRunId,
        status: it.status,
      });
    }
    return map;
  }, [lastResultsRaw]);

  const [dataset, setDataset] = useState<DatasetRecord | null>(null);
  const [isLoadingDataset, setIsLoadingDataset] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [totalRows, setTotalRows] = useState(0);
  const [editCell, setEditCell] = useState<EditCellState | null>(null);
  const [draftValue, setDraftValue] = useState<unknown>(undefined);
  const [cellErrors, setCellErrors] = useState<Map<string, string>>(new Map());
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );
  // Track shift key state for the select-all header tooltip (mirrors the
  // pattern in repository/columns.tsx). Used only to swap the tooltip
  // copy between "this page" vs "across all pages"; the actual select
  // behavior reads e.shiftKey directly from the click event.
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isSelectAllPending, setIsSelectAllPending] = useState(false);
  const [showPasteDialog, setShowPasteDialog] = useState(false);
  const [showAddColumnDialog, setShowAddColumnDialog] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnType, setNewColumnType] = useState<
    "STRING" | "INTEGER" | "BOOLEAN"
  >("STRING");
  const [newColumnRequired, setNewColumnRequired] = useState(false);
  const [newColumnSensitive, setNewColumnSensitive] = useState(false);
  const [addColumnError, setAddColumnError] = useState<string | null>(null);

  // Column-delete dialog state. `deleteColumnTarget` holds the column
  // name being considered for removal; `deleteColumnUsage` is set after
  // the usage probe finishes. When usage > 0 the dialog renders the
  // blocking variant with the referencing case list.
  const [deleteColumnTarget, setDeleteColumnTarget] = useState<{
    name: string;
    paramId: number;
  } | null>(null);
  const [deleteColumnUsage, setDeleteColumnUsage] = useState<{
    count: number;
    sampleCases: Array<{ id: number; name: string }>;
  } | null>(null);
  const [deleteColumnLoading, setDeleteColumnLoading] = useState(false);

  // ---------- Source toggle (per-case mode only) ----------
  // The Source segmented control is mounted only when this DatasetTab is
  // operating in the per-case "owner dataset" mode. In shared-editor /
  // shared-readonly modes the parent controls the entire surface and
  // there is no Local/Shared notion to switch between.
  const sourceToggleEnabled = !isShared;
  const { data: assignmentRaw } = useClientQueries(schema).caseSharedDataSetAssignment.useFindUnique(
    {
      where: { caseId },
      include: {
        sharedDataSet: { select: { id: true, name: true } },
      },
    },
    { enabled: sourceToggleEnabled }
  );
  const assignment = (assignmentRaw ?? null) as {
    id: number;
    sharedDataSetId: number;
    pinnedVersionId: number | null;
    mappingJson: unknown;
    sharedDataSet: { id: number; name: string } | null;
  } | null;
  const hasAssignment = assignment !== null;

  // PARAM-07 invariant: when there is no shared assignment, the default
  // is "local" — the entire owner-dataset code path is unchanged.
  const [viewSource, setViewSource] = useState<"local" | "shared">(() => {
    // Initial render uses "local" — useEffect below promotes to "shared"
    // when the assignment is loaded and there is no owner dataset on this
    // case. The hooks fire in render order so an explicit promotion keeps
    // the default selection logic deterministic.
    return "local";
  });
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showSwitchToLocalConfirm, setShowSwitchToLocalConfirm] =
    useState(false);

  // hasOwnerDataset: dataset is loaded AND has at least one row OR the
  // dataset record itself exists (the per-case API attaches an empty
  // DataSet for the case lazily). Once we know the API returned a
  // dataset, treat owner as present.
  const hasOwnerDataset = !isShared && dataset !== null;

  // Default-source promotion: only when no owner dataset exists AND a
  // shared assignment is present should we land on "shared" automatically.
  const promotedRef = useRef(false);
  useEffect(() => {
    if (!sourceToggleEnabled) return;
    if (promotedRef.current) return;
    if (!hasAssignment) return;
    // Wait until owner-dataset state has resolved.
    if (isLoadingDataset) return;
    promotedRef.current = true;
    if (!hasOwnerDataset) {
      setViewSource("shared");
    }
  }, [sourceToggleEnabled, hasAssignment, isLoadingDataset, hasOwnerDataset]);

  // ---------- Shared (read-only) view: resolve mapped rows ----------
  // In shared view we render rows fetched from the assignment's pinned
  // version (or the latest, when follow-latest). `applyMapping` projects
  // each row's columns onto the case's parameter names — imported from
  // the pure helper module so the client bundle does NOT pull
  // `iterationFanOut.ts` (and its Prisma type imports) along with it.
  const sharedAssignmentActive =
    sourceToggleEnabled && hasAssignment && viewSource === "shared";

  // For pinned: load that version directly. For follow-latest: load the
  // latest version of the assignment's dataset.
  const pinnedVersionId = assignment?.pinnedVersionId ?? null;
  const sharedDataSetId = assignment?.sharedDataSetId ?? null;
  const { data: pinnedVersionData } = useClientQueries(schema).dataSetVersion.useFindFirst(
    {
      where: { id: pinnedVersionId ?? -1 },
      select: { id: true, version: true, rowsJson: true },
    },
    {
      enabled: sharedAssignmentActive && pinnedVersionId !== null,
    }
  );
  const { data: latestVersionData } = useClientQueries(schema).dataSetVersion.useFindFirst(
    {
      where: { dataSetId: sharedDataSetId ?? -1 },
      orderBy: { version: "desc" },
      select: { id: true, version: true, rowsJson: true },
    },
    {
      enabled:
        sharedAssignmentActive &&
        pinnedVersionId === null &&
        sharedDataSetId !== null,
    }
  );

  const sharedSnapshot = useMemo(() => {
    if (!assignment) return null;
    const followLatest = assignment.pinnedVersionId === null;
    const versionRow = (
      followLatest ? latestVersionData : pinnedVersionData
    ) as { id: number; version: number; rowsJson: unknown } | null | undefined;
    if (!versionRow) {
      return {
        followLatest,
        versionNumber: null as number | null,
        rowsJson: [] as Array<{
          label?: string | null;
          valuesJson?: Record<string, unknown>;
        }>,
        sharedDataSet: assignment.sharedDataSet,
        mappingJson: (assignment.mappingJson as Record<string, string>) ?? {},
      };
    }
    const raw = versionRow.rowsJson;
    const list = Array.isArray(raw)
      ? (raw as Array<{
          label?: string | null;
          valuesJson?: Record<string, unknown>;
        }>)
      : [];
    return {
      followLatest,
      versionNumber: versionRow.version,
      rowsJson: list,
      sharedDataSet: assignment.sharedDataSet,
      mappingJson: (assignment.mappingJson as Record<string, string>) ?? {},
    };
  }, [assignment, pinnedVersionData, latestVersionData]);

  const sharedReadonlyRows = useMemo<DatasetTabRow[]>(() => {
    if (!sharedSnapshot) return [];
    const mapping = sharedSnapshot.mappingJson;
    return sharedSnapshot.rowsJson.map((r, idx) => ({
      // Synthetic negative ids — these are read-only display rows.
      id: -(idx + 1),
      label: r.label ?? null,
      rowIndex: idx,
      valuesJson: applyMapping(
        (r.valuesJson ?? {}) as Record<string, unknown>,
        mapping
      ) as Record<string, unknown>,
    }));
  }, [sharedSnapshot]);

  // In shared view, pretend isReadOnly=true so the table disables all
  // edit affordances. The original `isReadOnly` only fires for
  // mode === "shared-readonly"; we OR it with the per-case shared view
  // selection so the same render path is reused.
  const renderReadOnly =
    isReadOnly || (sourceToggleEnabled && viewSource === "shared");

  // In rendering below, when `viewSource === "shared"` (per-case mode),
  // we override the rows the table sees with `sharedReadonlyRows`.

  // In shared mode, rows are supplied by the parent. In owner-dataset
  // mode, rows live in this component's local state seeded from the
  // per-case API.
  const rows = useMemo(() => {
    if (sourceToggleEnabled && viewSource === "shared") {
      return sharedReadonlyRows;
    }
    return isShared ? (controlledRows ?? []) : (dataset?.rows ?? []);
  }, [
    isShared,
    controlledRows,
    dataset,
    sourceToggleEnabled,
    viewSource,
    sharedReadonlyRows,
  ]);
  const editCellRef = useRef<EditCellState | null>(null);
  editCellRef.current = editCell;

  // ---------- Dataset bootstrap ----------
  const loadDataset = useCallback(async () => {
    if (isShared) {
      // Shared mode: parent supplies rows. The component renders a
      // synthetic "loaded" state immediately so the empty-rows path
      // doesn't flash the loading spinner.
      setIsLoadingDataset(false);
      return;
    }
    setIsLoadingDataset(true);
    try {
      const url = `/api/repository/cases/${caseId}/dataset?page=${page}&pageSize=${pageSize}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      if (typeof json?.totalRows === "number") setTotalRows(json.totalRows);
      if (json?.dataset) {
        setDataset(json.dataset as DatasetRecord);
        return;
      }
      // No dataset yet — idempotent attach
      const attach = await fetch(`/api/repository/cases/${caseId}/dataset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (attach.ok) {
        const j2 = await attach.json();
        setDataset(j2?.dataset ?? null);
        setTotalRows(0);
      }
    } finally {
      setIsLoadingDataset(false);
    }
  }, [caseId, page, pageSize, isShared]);

  useEffect(() => {
    void loadDataset();
  }, [loadDataset]);

  // Shared-mode total comes from the parent-controlled rows length.
  useEffect(() => {
    if (isShared) setTotalRows(controlledRows?.length ?? 0);
  }, [isShared, controlledRows]);

  // Delay showing the loading indicator so quick fetches don't flash a spinner.
  useEffect(() => {
    if (!isLoadingDataset) {
      setShowLoading(false);
      return;
    }
    const timeout = setTimeout(() => setShowLoading(true), 300);
    return () => clearTimeout(timeout);
  }, [isLoadingDataset]);

  // If totalRows shrinks below the current page (e.g. after bulk delete),
  // step back to the last valid page.
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const showingFrom = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, totalRows);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // ---------- Sheet edit-state coordination ----------
  useEffect(() => {
    setEditingCell(editCell !== null);
    return () => {
      setEditingCell(false);
    };
  }, [editCell, setEditingCell]);

  // ---------- Shift-key tracking for the select-all header tooltip ----------
  // Matches the repository/columns.tsx pattern so the tooltip text can swap
  // between "this page" and "across all pages" while the user holds shift.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftPressed(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftPressed(false);
    };
    const onBlur = () => setIsShiftPressed(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ---------- Permission inference via [REDACTED] sentinel ----------
  const viewerCanReadSensitive = useMemo(() => {
    return !rows.some((r) =>
      Object.values(r.valuesJson ?? {}).some((v) => v === "[REDACTED]")
    );
  }, [rows]);

  // ---------- Pre-flight Zod schema ----------
  const rowSchema = useMemo(
    () =>
      buildRowSchemaFromParameters(
        parameters.map(
          (p): ParameterShape => ({
            name: p.name,
            type: p.type,
            required: p.required,
            allowedValuesJson: p.allowedValuesJson,
            lookupAllowedValues: p.lookupAllowedValues,
          })
        )
      ),
    [parameters]
  );

  // ---------- Mutations ----------
  const patchRow = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/repository/cases/${caseId}/dataset/rows`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error(t("datasetSaveError"));
        return false;
      }
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "DataSetRow"],
      });
      return true;
    },
    [caseId, queryClient, t]
  );

  const commitCell = useCallback(
    async (
      rowId: number,
      columnId: string,
      paramName: string | null,
      newValue: unknown
    ) => {
      // Per-cell Zod validation when this is a parameter column
      if (paramName !== null) {
        const partial = (rowSchema as any).pick({ [paramName]: true });
        const result = partial.safeParse({ [paramName]: newValue });
        if (!result.success) {
          setCellErrors((prev) => {
            const next = new Map(prev);
            next.set(
              `${rowId}.${columnId}`,
              result.error.issues[0]?.message ?? "Invalid value"
            );
            return next;
          });
          return;
        }
      }
      // Clear any prior error for this cell
      setCellErrors((prev) => {
        if (!prev.has(`${rowId}.${columnId}`)) return prev;
        const next = new Map(prev);
        next.delete(`${rowId}.${columnId}`);
        return next;
      });

      const row = rows.find((r) => r.id === rowId);
      if (!row) return;

      if (isShared) {
        // Shared-editor mode: push the change into the parent's buffered
        // rows. The parent flushes to the Save endpoint on demand.
        if (!onRowsChange) return;
        const next = rows.map((r) =>
          r.id !== rowId
            ? r
            : paramName === null
              ? { ...r, label: String(newValue ?? "") }
              : {
                  ...r,
                  valuesJson: {
                    ...(r.valuesJson ?? {}),
                    [paramName]: newValue,
                  },
                }
        );
        onRowsChange(next);
        return;
      }

      const body =
        paramName === null
          ? { rowId, label: newValue }
          : {
              rowId,
              valuesJson: { ...(row.valuesJson ?? {}), [paramName]: newValue },
            };
      const ok = await patchRow(body);
      if (ok) {
        // Optimistic local update so the cell shows the new value
        setDataset((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map((r) =>
              r.id !== rowId
                ? r
                : paramName === null
                  ? { ...r, label: String(newValue ?? "") }
                  : {
                      ...r,
                      valuesJson: {
                        ...(r.valuesJson ?? {}),
                        [paramName]: newValue,
                      },
                    }
            ),
          };
        });
      }
    },
    [patchRow, rowSchema, rows, isShared, onRowsChange]
  );

  // ---------- Add row ----------
  const handleAddRow = useCallback(async () => {
    const nextIndex = totalRows;
    if (isShared) {
      if (!onRowsChange) return;
      // Synthetic negative ids prevent collisions with any positive
      // server-side ids the parent might mix in. Re-indexing happens at
      // Save time on the server.
      const synthId = -(Date.now() + Math.floor(Math.random() * 1000));
      const newRow: DatasetTabRow = {
        id: synthId,
        label: t("datasetRowDefaultLabel", { number: String(nextIndex + 1) }),
        rowIndex: nextIndex,
        valuesJson: {},
      };
      onRowsChange([...rows, newRow]);
      const newTotal = nextIndex + 1;
      const lastPage = Math.max(1, Math.ceil(newTotal / pageSize));
      if (lastPage !== page) setPage(lastPage);
      return;
    }
    const res = await fetch(`/api/repository/cases/${caseId}/dataset/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowIndex: nextIndex,
        label: t("datasetRowDefaultLabel", { number: String(nextIndex + 1) }),
        valuesJson: {},
      }),
    });
    if (!res.ok) {
      toast.error(t("datasetSaveError"));
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: ["zenstack", "DataSetRow"],
    });
    // Jump to the last page so the new row is visible.
    const newTotal = totalRows + 1;
    const lastPage = Math.max(1, Math.ceil(newTotal / pageSize));
    if (lastPage !== page) setPage(lastPage);
    else await loadDataset();
  }, [
    caseId,
    queryClient,
    totalRows,
    pageSize,
    page,
    t,
    loadDataset,
    isShared,
    onRowsChange,
    rows,
  ]);

  // ---------- Move helpers (UI-SPEC D.2) ----------
  const moveCell = useCallback(
    (direction: "left" | "right") => {
      if (!editCellRef.current) return;
      const { rowId, columnId } = editCellRef.current;
      const orderedColumnIds = [
        LABEL_COLUMN_ID,
        ...parameters.map((p) => `param-${p.id}`),
      ];
      const idx = orderedColumnIds.indexOf(columnId);
      if (idx < 0) return;
      const nextIdx =
        direction === "right"
          ? Math.min(orderedColumnIds.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      if (nextIdx === idx) {
        setEditCell(null);
        return;
      }
      const nextColumnId = orderedColumnIds[nextIdx];
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      const seedValue = seedValueFor(row, nextColumnId, parameters);
      setEditCell({ rowId, columnId: nextColumnId });
      setDraftValue(seedValue);
    },
    [parameters, rows]
  );

  const moveDown = useCallback(() => {
    if (!editCellRef.current) return;
    const { rowId, columnId } = editCellRef.current;
    const idx = rows.findIndex((r) => r.id === rowId);
    if (idx < 0 || idx >= rows.length - 1) {
      setEditCell(null);
      return;
    }
    const nextRow = rows[idx + 1];
    const seedValue = seedValueFor(nextRow, columnId, parameters);
    setEditCell({ rowId: nextRow.id, columnId });
    setDraftValue(seedValue);
  }, [parameters, rows]);

  // ---------- Drag-reorder ----------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = rows.findIndex(
      (r) => String(r.id) === String(event.active.id)
    );
    const newIndex = rows.findIndex(
      (r) => String(r.id) === String(event.over!.id)
    );
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(rows, oldIndex, newIndex);
    // Reordering is page-scoped: write back the absolute rowIndex range
    // (pageStart..pageStart+pageLen-1) so other pages stay put.
    const pageStart = (page - 1) * pageSize;
    if (isShared) {
      if (!onRowsChange) return;
      onRowsChange(
        reordered.map((r, idx) => ({ ...r, rowIndex: pageStart + idx }))
      );
      return;
    }
    setDataset((prev) =>
      prev
        ? {
            ...prev,
            rows: reordered.map((r, idx) => ({
              ...r,
              rowIndex: pageStart + idx,
            })),
          }
        : prev
    );
    await Promise.all(
      reordered.map((r, idx) =>
        fetch(`/api/repository/cases/${caseId}/dataset/rows`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId: r.id, rowIndex: pageStart + idx }),
        })
      )
    );
    void queryClient.invalidateQueries({
      queryKey: ["zenstack", "DataSetRow"],
    });
  };

  // ---------- Column delete (shared-editor mode) ----------
  // Probes the server for any CaseSharedDataSetAssignment.mappingJson
  // that references the column. A non-zero usage count blocks the
  // delete and surfaces which cases need their mappings updated first.
  // Newly-added columns (paramId < 0) skip the probe — they can't be
  // referenced yet because they don't exist on the server.
  const beginDeleteColumn = useCallback(
    async (target: { name: string; paramId: number }) => {
      setDeleteColumnTarget(target);
      setDeleteColumnUsage(null);
      if (target.paramId < 0) {
        setDeleteColumnUsage({ count: 0, sampleCases: [] });
        return;
      }
      setDeleteColumnLoading(true);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/datasets/${caseId}/column-usage?column=${encodeURIComponent(target.name)}`
        );
        if (!res.ok) {
          toast.error(t("datasetColumnDeleteCheckError"));
          setDeleteColumnTarget(null);
          return;
        }
        const body = (await res.json()) as {
          count: number;
          sampleCases: Array<{ id: number; name: string }>;
        };
        setDeleteColumnUsage(body);
      } catch {
        toast.error(t("datasetColumnDeleteCheckError"));
        setDeleteColumnTarget(null);
      } finally {
        setDeleteColumnLoading(false);
      }
    },
    [caseId, projectId, t]
  );

  const commitDeleteColumn = useCallback(() => {
    if (!deleteColumnTarget || !onParametersChange) return;
    onParametersChange(
      parameters.filter((p) => p.id !== deleteColumnTarget.paramId)
    );
    setDeleteColumnTarget(null);
    setDeleteColumnUsage(null);
  }, [deleteColumnTarget, onParametersChange, parameters]);

  // ---------- Select-all helpers ----------
  // Click on the header checkbox toggles the rows currently visible on this
  // page. Shift-click toggles every row across every page — in shared-editor
  // mode all rows are in memory (`rows`); in owner-bound mode we fetch every
  // row id from the dataset endpoint without `?page=` so the page-scoped API
  // does not gate the operation.
  const togglePageRowIds = useCallback((pageRowIds: number[]) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      const allSelected = pageRowIds.every((id) => next.has(id));
      if (allSelected) {
        for (const id of pageRowIds) next.delete(id);
      } else {
        for (const id of pageRowIds) next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllAcrossPages = useCallback(
    async (pageRowIds: number[]) => {
      // The "is everything already selected?" decision must be made against
      // the full dataset, not just the visible page. In shared-editor mode
      // we can read `rows` directly. In owner-bound mode we use `totalRows`
      // as the source of truth.
      if (isShared) {
        const allIds = rows.map((r) => r.id);
        const allSelected =
          allIds.length > 0 && allIds.every((id) => selectedRowIds.has(id));
        setSelectedRowIds(allSelected ? new Set() : new Set(allIds));
        return;
      }
      // Owner-bound mode: figure out current "all selected" state from
      // selectedRowIds.size vs totalRows. If everything is selected we
      // just clear without a fetch.
      if (selectedRowIds.size >= totalRows && totalRows > 0) {
        setSelectedRowIds(new Set());
        return;
      }
      setIsSelectAllPending(true);
      try {
        const res = await fetch(
          `/api/repository/cases/${caseId}/dataset?pageSize=10000`
        );
        if (!res.ok) {
          // Fall back to selecting just the visible page rather than a
          // silent no-op.
          togglePageRowIds(pageRowIds);
          return;
        }
        const json = await res.json();
        const allRowIds: number[] = Array.isArray(json?.dataset?.rows)
          ? json.dataset.rows
              .map((r: { id: number }) => r.id)
              .filter((id: unknown): id is number => typeof id === "number")
          : [];
        if (allRowIds.length === 0) {
          togglePageRowIds(pageRowIds);
          return;
        }
        setSelectedRowIds(new Set(allRowIds));
      } catch {
        togglePageRowIds(pageRowIds);
      } finally {
        setIsSelectAllPending(false);
      }
    },
    [caseId, isShared, rows, selectedRowIds, togglePageRowIds, totalRows]
  );

  const handleSelectAllClick = useCallback(
    (e: React.MouseEvent, pageRowIds: number[]) => {
      e.stopPropagation();
      if (e.shiftKey) {
        e.preventDefault();
        void selectAllAcrossPages(pageRowIds);
        return;
      }
      togglePageRowIds(pageRowIds);
    },
    [selectAllAcrossPages, togglePageRowIds]
  );

  // ---------- Build columns ----------
  const columns = useMemo<ColumnDef<DatasetRowRecord>[]>(() => {
    const cellHandlers = (
      rowId: number,
      columnId: string,
      paramName: string | null,
      currentValue: unknown
    ) => ({
      onEdit: renderReadOnly
        ? () => {
            /* readonly: cell click is a no-op */
          }
        : () => {
            setEditCell({ rowId, columnId });
            setDraftValue(currentValue);
          },
      onChange: (v: unknown) => setDraftValue(v),
      onCommit: () => {
        void commitCell(rowId, columnId, paramName, draftValue);
        setEditCell(null);
        setDraftValue(undefined);
      },
      onCommitValue: (value: unknown) => {
        void commitCell(rowId, columnId, paramName, value);
        setEditCell(null);
        setDraftValue(undefined);
      },
      onCancel: () => {
        setEditCell(null);
        setDraftValue(undefined);
      },
      onTab: (direction: "left" | "right") => moveCell(direction),
      onMoveDown: () => moveDown(),
    });

    const cols: ColumnDef<DatasetRowRecord>[] = [
      {
        id: DRAG_COLUMN_ID,
        size: 24,
        header: () => null,
        cell: () => null,
      },
      {
        id: SELECT_COLUMN_ID,
        size: 32,
        header: ({ table }) => {
          if (renderReadOnly) return null;
          const visibleRows = table.getRowModel().rows;
          const pageRowIds = visibleRows.map((r) => r.original.id);
          const selectedOnPage = pageRowIds.filter((id) =>
            selectedRowIds.has(id)
          ).length;
          const allOnPageSelected =
            pageRowIds.length > 0 && selectedOnPage === pageRowIds.length;
          const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected;
          const allAcrossPagesSelected =
            totalRows > 0 && selectedRowIds.size >= totalRows;
          const tooltipKey = isShiftPressed
            ? allAcrossPagesSelected
              ? "datasetDeselectAllAcrossPagesTooltip"
              : "datasetSelectAllAcrossPagesTooltip"
            : "datasetSelectAllPageTooltip";
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center">
                  <Checkbox
                    checked={
                      someOnPageSelected ? "indeterminate" : allOnPageSelected
                    }
                    disabled={isSelectAllPending}
                    onCheckedChange={() => {
                      /* handled in onClick to capture shiftKey */
                    }}
                    onClick={(e) => handleSelectAllClick(e, pageRowIds)}
                    aria-label={t(tooltipKey, { count: totalRows })}
                    data-testid="dataset-select-all"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" sideOffset={8}>
                {t(tooltipKey, { count: totalRows })}
              </TooltipContent>
            </Tooltip>
          );
        },
        cell: ({ row }) => {
          const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            const visibleIndex = row.index;
            if (
              e.shiftKey &&
              lastSelectedIndex !== null &&
              lastSelectedIndex !== visibleIndex
            ) {
              const start = Math.min(lastSelectedIndex, visibleIndex);
              const end = Math.max(lastSelectedIndex, visibleIndex);
              setSelectedRowIds((prev) => {
                const next = new Set(prev);
                for (let i = start; i <= end; i++) {
                  const r = rows[i];
                  if (r) next.add(r.id);
                }
                return next;
              });
            } else {
              setSelectedRowIds((prev) => {
                const next = new Set(prev);
                if (next.has(row.original.id)) next.delete(row.original.id);
                else next.add(row.original.id);
                return next;
              });
              setLastSelectedIndex(visibleIndex);
            }
          };
          return (
            <div className="flex items-center justify-center">
              <Checkbox
                checked={selectedRowIds.has(row.original.id)}
                onCheckedChange={() => {
                  /* handled in onClick to capture shiftKey */
                }}
                onClick={handleClick}
                aria-label={t("datasetRowSelectAria")}
                data-testid={`dataset-row-select-${row.original.id}`}
              />
            </div>
          );
        },
      },
      {
        id: LABEL_COLUMN_ID,
        minSize: 100,
        header: () => t("datasetLabelColumn"),
        accessorKey: "label",
        cell: ({ row }) => {
          const isEditing =
            editCell?.rowId === row.original.id &&
            editCell.columnId === LABEL_COLUMN_ID;
          const handlers = cellHandlers(
            row.original.id,
            LABEL_COLUMN_ID,
            null,
            row.original.label ?? ""
          );
          return (
            <DatasetCell
              rowId={row.original.id}
              columnId={LABEL_COLUMN_ID}
              value={row.original.label ?? ""}
              isLabel
              isEditing={isEditing}
              draftValue={isEditing ? draftValue : ""}
              error={cellErrors.get(`${row.original.id}.${LABEL_COLUMN_ID}`)}
              viewerCanReadSensitive={viewerCanReadSensitive}
              {...handlers}
            />
          );
        },
      },
      ...parameters.map((p) => {
        const colId = `param-${p.id}`;
        const showHeaderMenu =
          isShared && mode === "shared-editor" && !!onParametersChange;
        return {
          id: colId,
          minSize: 180,
          header: () => (
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="font-mono text-sm">{`@${p.name}`}</span>
              <Badge variant="secondary">{p.type}</Badge>
              {p.sensitive ? (
                <Lock className="w-3 h-3 text-muted-foreground" />
              ) : null}
              {showHeaderMenu && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="px-1 py-0 h-auto ml-auto"
                      aria-label={t("datasetColumnMenuLabel", { name: p.name })}
                      data-testid={`dataset-column-menu-${p.name}`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() =>
                        beginDeleteColumn({ name: p.name, paramId: p.id })
                      }
                      data-testid={`dataset-column-delete-${p.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("datasetColumnDelete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ),
          accessorFn: (row: DatasetRowRecord) =>
            (row.valuesJson as Record<string, unknown> | null)?.[p.name],
          cell: ({ row }: { row: { original: DatasetRowRecord } }) => {
            const cellValue = (
              row.original.valuesJson as Record<string, unknown> | null
            )?.[p.name];
            const isEditing =
              editCell?.rowId === row.original.id &&
              editCell.columnId === colId;
            const handlers = cellHandlers(
              row.original.id,
              colId,
              p.name,
              cellValue
            );
            return (
              <DatasetCell
                rowId={row.original.id}
                columnId={colId}
                value={cellValue}
                parameter={{
                  name: p.name,
                  type: p.type,
                  sensitive: p.sensitive,
                  required: p.required,
                  allowedValuesJson: p.allowedValuesJson,
                  lookupAllowedValues: p.lookupAllowedValues,
                }}
                isEditing={isEditing}
                draftValue={isEditing ? draftValue : ""}
                error={cellErrors.get(`${row.original.id}.${colId}`)}
                viewerCanReadSensitive={viewerCanReadSensitive}
                {...handlers}
              />
            );
          },
        } as ColumnDef<DatasetRowRecord>;
      }),
    ];

    // Surface F.1: trailing "Last result" column — only when the case has
    // been run at least once. PARAM-07 invariant: cases without run history
    // see no new column.
    if (caseHasRunHistory) {
      cols.push({
        id: RESULT_COLUMN_ID,
        size: 128,
        minSize: 128,
        header: () => t("datasetRowResultsHeader"),
        cell: ({ row }: { row: { original: DatasetRowRecord } }) => {
          const entry = lastResultByRowIndex.get(row.original.rowIndex);
          if (!entry) {
            return (
              <span
                className="text-xs text-muted-foreground"
                data-testid={`dataset-row-result-empty-${row.original.rowIndex}`}
              >
                {t("datasetRowResultEmpty")}
              </span>
            );
          }
          const handleClick = () => {
            router.push(
              `/projects/runs/${projectId}/${entry.runId}?iteration=${
                entry.rowIndex + 1
              }&selectedCase=${caseId}`
            );
          };
          return (
            <button
              type="button"
              onClick={handleClick}
              data-testid={`dataset-row-result-link-${row.original.rowIndex}`}
              className="text-sm hover:underline focus-visible:underline focus-visible:outline-none"
            >
              <StatusDotDisplay
                name={entry.status.name}
                color={entry.status.color?.value}
              />
            </button>
          );
        },
      } as ColumnDef<DatasetRowRecord>);
    }

    return cols;
  }, [
    parameters,
    editCell,
    draftValue,
    cellErrors,
    selectedRowIds,
    lastSelectedIndex,
    rows,
    viewerCanReadSensitive,
    t,
    commitCell,
    moveCell,
    moveDown,
    caseHasRunHistory,
    lastResultByRowIndex,
    caseId,
    projectId,
    router,
    renderReadOnly,
    isShiftPressed,
    isSelectAllPending,
    totalRows,
    handleSelectAllClick,
  ]);

  const table = useReactTable<DatasetRowRecord>({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  // ---------- Render ----------
  // Owner-dataset mode bootstraps via API and renders nothing until the
  // backing DataSet record is loaded. Shared mode is parent-controlled
  // and renders immediately against the supplied rows.
  if (!isShared && !dataset) return null;

  const hasSelection = selectedRowIds.size > 0;

  // Shared-mode bulk-delete: route through onRowsChange instead of the
  // per-case API. The "delete" semantic in shared mode just removes
  // rows from the parent's buffered list — Save then commits the new
  // shape as a fresh version.
  const handleSharedBulkDelete = () => {
    if (!onRowsChange) return;
    const ids = selectedRowIds;
    onRowsChange(rows.filter((r) => !ids.has(r.id)));
    setSelectedRowIds(new Set());
  };

  // Owner+shared coexistence — Amendment A. Render an info banner in
  // BOTH local and shared views explaining that iteration uses local
  // rows when both are present.
  const showOwnerSharedBanner =
    sourceToggleEnabled && hasOwnerDataset && hasAssignment;

  // Source-toggle handler. When switching Local→Shared with no
  // assignment yet, open the assignment dialog. When switching
  // Shared→Local while an assignment exists AND no owner dataset is
  // present, open the confirm AlertDialog (the assignment will be
  // deleted on confirm). When an owner dataset is present, the
  // Local↔Shared switch is non-destructive.
  const handleSourceChange = (next: "local" | "shared") => {
    if (next === viewSource) return;
    if (next === "shared") {
      if (!hasAssignment) {
        setShowAssignDialog(true);
        return;
      }
      setViewSource("shared");
      return;
    }
    // next === "local"
    if (hasAssignment && !hasOwnerDataset) {
      setShowSwitchToLocalConfirm(true);
      return;
    }
    setViewSource("local");
  };

  const handleConfirmSwitchToLocal = async () => {
    try {
      const res = await fetch(
        `/api/repository/cases/${caseId}/shared-dataset`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        toast.error(t("datasetSaveError"));
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "CaseSharedDataSetAssignment"],
      });
      setViewSource("local");
      setShowSwitchToLocalConfirm(false);
    } catch {
      toast.error(t("datasetSaveError"));
    }
  };

  // Resolve the shared-view header data (dataset name + version label).
  const sharedHeaderName = sharedSnapshot?.sharedDataSet?.name ?? "";
  const sharedHeaderVersion = sharedSnapshot?.versionNumber ?? null;
  const sharedFollowLatest = sharedSnapshot?.followLatest ?? false;

  return (
    <div className="flex flex-col h-full">
      <div
        className="p-4 border-b bg-card flex flex-col gap-3"
        data-testid="dataset-tab-toolbar"
      >
        {sourceToggleEnabled && (
          <div className="flex items-center justify-between">
            <ToggleGroup
              type="single"
              value={viewSource}
              onValueChange={(v) => {
                if (v === "local" || v === "shared") handleSourceChange(v);
              }}
              data-testid="dataset-source-toggle"
            >
              <ToggleGroupItem
                value="local"
                data-testid="dataset-source-local"
                aria-label={t("datasetSourceLocal")}
              >
                {t("datasetSourceLocal")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="shared"
                data-testid="dataset-source-shared"
                aria-label={t("datasetSourceShared")}
              >
                {t("datasetSourceShared")}
              </ToggleGroupItem>
            </ToggleGroup>
            {hasOwnerDataset && hasAssignment && (
              <Badge variant="outline" data-testid="dataset-shared-ref-badge">
                {t("datasetSharedRefBadge")}
              </Badge>
            )}
          </div>
        )}

        {viewSource === "shared" && hasAssignment && sharedSnapshot && (
          <div
            className="flex items-center justify-between"
            data-testid="dataset-shared-header"
          >
            <div className="flex items-center gap-2 text-sm">
              <span>
                {t("datasetSharedHeader", {
                  datasetName: sharedHeaderName,
                  version: String(sharedHeaderVersion ?? 0),
                })}
              </span>
              <Button asChild variant="link" size="sm">
                <Link
                  href={`/projects/settings/${projectId}/datasets/${assignment?.sharedDataSetId}`}
                >
                  {t("datasetViewSource")}
                </Link>
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {sharedFollowLatest ? (
                <Badge
                  variant="outline"
                  data-testid="dataset-shared-version-badge"
                >
                  {t("datasetSharedVersionFollowLatest", {
                    version: String(sharedHeaderVersion ?? 0),
                  })}
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  data-testid="dataset-shared-version-badge"
                >
                  {t("datasetSharedVersionPinned", {
                    version: String(sharedHeaderVersion ?? 0),
                  })}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAssignDialog(true)}
                data-testid="dataset-shared-edit-assignment"
              >
                {t("datasetSharedEditAssignment")}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          {hasSelection && !renderReadOnly ? (
            isShared ? (
              <div className="flex items-center justify-between w-full">
                <span className="text-sm">
                  {t("datasetSelectedCount", {
                    count: String(selectedRowIds.size),
                  })}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRowIds(new Set())}
                  >
                    {t("datasetClearSelection")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleSharedBulkDelete}
                    data-testid="dataset-shared-bulk-delete-button"
                  >
                    {t("datasetDeleteSelected")}
                  </Button>
                </div>
              </div>
            ) : (
              <DatasetRowActions
                caseId={caseId}
                selectedRowIds={Array.from(selectedRowIds)}
                onClear={() => setSelectedRowIds(new Set())}
                onAfterDelete={loadDataset}
              />
            )
          ) : (
            <>
              <div className="flex flex-col">
                <span className="text-sm text-muted-foreground">
                  {t("datasetCounts", {
                    paramCount: String(parameters.length),
                    rowCount: String(totalRows),
                  })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("datasetEditingHint")}
                </span>
              </div>
              {!renderReadOnly && (
                <div className="flex gap-2">
                  {!isShared && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowPasteDialog(true)}
                              data-testid="dataset-paste-csv-button"
                            >
                              <ClipboardPaste className="w-4 h-4" />
                              {t("datasetPasteCsv")}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {renderReadOnly && (
                          <TooltipContent>
                            {t("datasetSharedReadOnly")}
                          </TooltipContent>
                        )}
                      </Tooltip>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenImportWizard?.()}
                        data-testid="dataset-import-csv-button"
                      >
                        <Upload className="w-4 h-4" />
                        {t("datasetImportCsv")}
                      </Button>
                    </>
                  )}
                  {isShared &&
                    mode === "shared-editor" &&
                    onParametersChange && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddColumnDialog(true)}
                        data-testid="dataset-add-column-button"
                      >
                        <Plus className="w-4 h-4" />
                        {t("datasetAddColumn")}
                      </Button>
                    )}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleAddRow}
                    data-testid="dataset-add-row-button"
                  >
                    <Plus className="w-4 h-4" />
                    {t("datasetAddRow")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showOwnerSharedBanner && (
        <Alert
          variant="default"
          className="m-4 mb-0"
          data-testid="dataset-owner-shared-banner"
        >
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>
              {viewSource === "local"
                ? t("datasetOwnerWinsLocal")
                : t("datasetOwnerWinsShared")}
            </span>
            <Button
              variant="link"
              size="sm"
              onClick={() =>
                handleSourceChange(viewSource === "local" ? "shared" : "local")
              }
            >
              {viewSource === "local"
                ? t("datasetViewSharedRef")
                : t("datasetSwitchToLocal")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoadingDataset && !showLoading ? (
        <div className="flex-1" aria-hidden="true" />
      ) : isLoadingDataset ? (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-3 p-8"
          data-testid="dataset-tab-loading"
        >
          <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-3 p-8"
          data-testid="dataset-tab-empty"
        >
          <Table2 className="w-12 h-12 text-muted-foreground" />
          <h3 className="text-base font-semibold">
            {t("datasetEmptyHeading")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("datasetEmptyBody")}
          </p>
          {!renderReadOnly && (
            <div className="flex gap-2">
              <Button variant="default" size="sm" onClick={handleAddRow}>
                {t("datasetAddRow")}
              </Button>
              {!isShared && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPasteDialog(true)}
                  >
                    {t("datasetPasteCsv")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenImportWizard?.()}
                  >
                    {t("datasetImportCsv")}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis]}
          >
            <SortableContext
              items={rows.map((r) => String(r.id))}
              strategy={verticalListSortingStrategy}
            >
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 z-10">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((h) => {
                        const minSize = h.column.columnDef.minSize;
                        // Lock the drag + checkbox columns to fixed widths
                        // so they don't grow with the cell content.
                        const isDragCol = h.column.id === DRAG_COLUMN_ID;
                        const isSelectCol = h.column.id === SELECT_COLUMN_ID;
                        const fixedWidth = isDragCol
                          ? "32px"
                          : isSelectCol
                            ? "40px"
                            : undefined;
                        return (
                          <th
                            key={h.id}
                            // Use bg-muted (not bg-accent) so text inherits
                            // text-foreground correctly in both light and
                            // dark themes. `bg-accent` is a light-ish
                            // background in dark mode and pairs only with
                            // its own foreground token; we render plain
                            // muted text in the header.
                            className="px-2 py-1 text-left bg-muted/50 border-b font-medium"
                            style={
                              fixedWidth
                                ? {
                                    width: fixedWidth,
                                    minWidth: fixedWidth,
                                    maxWidth: fixedWidth,
                                  }
                                : minSize
                                  ? { minWidth: `${minSize}px` }
                                  : undefined
                            }
                          >
                            {flexRender(
                              h.column.columnDef.header,
                              h.getContext()
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <SortableDatasetRow key={row.id} id={row.original.id}>
                      {({
                        attributes,
                        listeners,
                        setNodeRef,
                        setActivatorNodeRef,
                        transform,
                        transition,
                        isDragging,
                        dropIndicator,
                      }) => (
                        <tr
                          ref={setNodeRef}
                          style={{
                            transform: CSS.Transform.toString(transform),
                            transition,
                            opacity: isDragging ? 0.5 : 1,
                          }}
                          {...attributes}
                          data-testid={`dataset-row-${row.original.id}`}
                        >
                          <td
                            className="px-2 py-1 align-middle relative"
                            style={{
                              width: "32px",
                              minWidth: "32px",
                              maxWidth: "32px",
                            }}
                          >
                            {dropIndicator === "top" && (
                              <div
                                className="absolute top-0 left-0 right-0 h-[3px] bg-primary z-50 pointer-events-none w-screen"
                                aria-hidden="true"
                                data-testid={`dataset-row-drop-indicator-top-${row.original.id}`}
                              />
                            )}
                            {dropIndicator === "bottom" && (
                              <div
                                className="absolute bottom-0 left-0 right-0 h-[3px] bg-primary z-50 pointer-events-none w-screen"
                                aria-hidden="true"
                                data-testid={`dataset-row-drop-indicator-bottom-${row.original.id}`}
                              />
                            )}
                            <div
                              ref={setActivatorNodeRef}
                              {...(renderReadOnly ? {} : listeners)}
                              className={
                                renderReadOnly
                                  ? "text-muted-foreground/40"
                                  : "cursor-grab text-muted-foreground"
                              }
                              data-testid={`dataset-row-drag-handle-${row.original.id}`}
                              aria-label="Drag to reorder"
                            >
                              <GripVertical className="w-4 h-4" />
                            </div>
                          </td>
                          {row
                            .getVisibleCells()
                            .slice(1)
                            .map((cell) => {
                              const minSize = cell.column.columnDef.minSize;
                              const isSelectCol =
                                cell.column.id === SELECT_COLUMN_ID;
                              const fixedWidth = isSelectCol
                                ? "40px"
                                : undefined;
                              return (
                                <td
                                  key={cell.id}
                                  className="px-2 py-1 align-middle"
                                  style={
                                    fixedWidth
                                      ? {
                                          width: fixedWidth,
                                          minWidth: fixedWidth,
                                          maxWidth: fixedWidth,
                                        }
                                      : minSize
                                        ? { minWidth: `${minSize}px` }
                                        : undefined
                                  }
                                >
                                  {flexRender(
                                    cell.column.columnDef.cell,
                                    cell.getContext()
                                  )}
                                </td>
                              );
                            })}
                        </tr>
                      )}
                    </SortableDatasetRow>
                  ))}
                </tbody>
              </table>
            </SortableContext>
          </DndContext>
        </div>
      )}

      <div
        className="p-2 pl-4 pr-2 border-t flex items-center justify-end gap-3"
        data-testid="dataset-tab-footer"
      >
        {totalRows > 0 && (
          <div
            className="flex items-center gap-2"
            data-testid="dataset-tab-pagination"
          >
            <div className="text-sm text-muted-foreground">
              {tCommon("pagination.showing")} {showingFrom}-{showingTo}{" "}
              {tCommon("of")} {totalRows} {tCommon("results")}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage(1)}
              disabled={page === 1}
              data-testid="dataset-page-first"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              data-testid="dataset-page-prev"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-1">
              <span className="text-sm">{tSearchResults("page")}</span>
              <Input
                type="number"
                min={1}
                max={totalPages}
                value={page}
                onChange={(e) => {
                  const next = parseInt(e.target.value) || 1;
                  if (next >= 1 && next <= totalPages) setPage(next);
                }}
                className="w-16 h-9 text-center"
                data-testid="dataset-page-input"
              />
              <span className="text-sm">
                {tCommon("of")} {totalPages}
              </span>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              data-testid="dataset-page-next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              data-testid="dataset-page-last"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {!isShared && (
        <PasteCsvDialog
          open={showPasteDialog}
          onOpenChange={setShowPasteDialog}
          caseId={caseId}
          parameters={parameters}
        />
      )}

      {isShared && mode === "shared-editor" && onParametersChange && (
        <AlertDialog
          open={showAddColumnDialog}
          onOpenChange={(open) => {
            setShowAddColumnDialog(open);
            if (!open) {
              setNewColumnName("");
              setNewColumnType("STRING");
              setNewColumnRequired(false);
              setNewColumnSensitive(false);
              setAddColumnError(null);
            }
          }}
        >
          <AlertDialogContent
            data-testid="dataset-add-column-dialog"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newColumnName.trim()) {
                e.preventDefault();
                const name = newColumnName.trim();
                const exists = parameters.some((p) => p.name === name);
                if (exists) {
                  setAddColumnError(t("datasetAddColumnDuplicate"));
                  return;
                }
                onParametersChange([
                  ...parameters,
                  {
                    id: -(parameters.length + 1),
                    name,
                    type: newColumnType,
                    sensitive: newColumnSensitive,
                    required: newColumnRequired,
                  },
                ]);
                setShowAddColumnDialog(false);
                setNewColumnName("");
                setNewColumnType("STRING");
                setNewColumnRequired(false);
                setNewColumnSensitive(false);
                setAddColumnError(null);
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{t("datasetAddColumnTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("datasetAddColumnDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  className="text-xs font-medium"
                  htmlFor="dataset-add-column-input"
                >
                  {t("formName")}
                </label>
                <Input
                  id="dataset-add-column-input"
                  value={newColumnName}
                  onChange={(e) => {
                    setNewColumnName(e.target.value);
                    setAddColumnError(null);
                  }}
                  placeholder={t("datasetAddColumnPlaceholder")}
                  data-testid="dataset-add-column-input"
                  autoFocus
                />
              </div>
              <div>
                <label
                  className="text-xs font-medium"
                  htmlFor="dataset-add-column-type"
                >
                  {t("formType")}
                </label>
                <Select
                  value={newColumnType}
                  onValueChange={(v) =>
                    setNewColumnType(v as "STRING" | "INTEGER" | "BOOLEAN")
                  }
                >
                  <SelectTrigger
                    id="dataset-add-column-type"
                    data-testid="dataset-add-column-type"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STRING">{"STRING"}</SelectItem>
                    <SelectItem value="INTEGER">{"INTEGER"}</SelectItem>
                    <SelectItem value="BOOLEAN">{"BOOLEAN"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dataset-add-column-required"
                  data-testid="dataset-add-column-required"
                  checked={newColumnRequired}
                  onCheckedChange={(v) => setNewColumnRequired(Boolean(v))}
                />
                <label
                  htmlFor="dataset-add-column-required"
                  className="text-xs font-medium"
                >
                  {t("formRequired")}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dataset-add-column-sensitive"
                  data-testid="dataset-add-column-sensitive"
                  checked={newColumnSensitive}
                  onCheckedChange={(v) => setNewColumnSensitive(Boolean(v))}
                />
                <label
                  htmlFor="dataset-add-column-sensitive"
                  className="text-xs font-medium"
                >
                  {t("formSensitive")}
                </label>
              </div>
            </div>
            {addColumnError && (
              <p
                className="text-sm text-destructive"
                data-testid="dataset-add-column-error"
              >
                {addColumnError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
              <Button
                disabled={!newColumnName.trim()}
                onClick={() => {
                  const name = newColumnName.trim();
                  const exists = parameters.some((p) => p.name === name);
                  if (exists) {
                    setAddColumnError(t("datasetAddColumnDuplicate"));
                    return;
                  }
                  onParametersChange([
                    ...parameters,
                    {
                      id: -(parameters.length + 1),
                      name,
                      type: newColumnType,
                      sensitive: newColumnSensitive,
                      required: newColumnRequired,
                    },
                  ]);
                  setShowAddColumnDialog(false);
                  setNewColumnName("");
                  setNewColumnType("STRING");
                  setNewColumnRequired(false);
                  setNewColumnSensitive(false);
                  setAddColumnError(null);
                }}
                data-testid="dataset-add-column-submit"
              >
                {t("datasetAddColumnSubmit")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {isShared && mode === "shared-editor" && onParametersChange && (
        <AlertDialog
          open={deleteColumnTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteColumnTarget(null);
              setDeleteColumnUsage(null);
            }
          }}
        >
          <AlertDialogContent data-testid="dataset-column-delete-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("datasetColumnDeleteTitle", {
                  name: deleteColumnTarget?.name ?? "",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteColumnLoading
                  ? t("datasetColumnDeleteChecking")
                  : deleteColumnUsage && deleteColumnUsage.count > 0
                    ? t("datasetColumnDeleteBlocked", {
                        count: deleteColumnUsage.count,
                      })
                    : t("datasetColumnDeleteDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteColumnUsage && deleteColumnUsage.count > 0 && (
              <ul
                className="text-sm text-muted-foreground space-y-1 max-h-48 overflow-auto"
                data-testid="dataset-column-delete-cases"
              >
                {deleteColumnUsage.sampleCases.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/projects/repository/${projectId}/${c.id}`}
                      className="hover:underline text-primary"
                      target="_blank"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
                {deleteColumnUsage.count >
                  deleteColumnUsage.sampleCases.length && (
                  <li className="italic">
                    {t("datasetColumnDeleteAndMore", {
                      count:
                        deleteColumnUsage.count -
                        deleteColumnUsage.sampleCases.length,
                    })}
                  </li>
                )}
              </ul>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
              {deleteColumnUsage && deleteColumnUsage.count === 0 && (
                <Button
                  variant="destructive"
                  onClick={commitDeleteColumn}
                  data-testid="dataset-column-delete-confirm"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("datasetColumnDeleteConfirm")}
                </Button>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {sourceToggleEnabled && (
        <AssignSharedDatasetDialog
          open={showAssignDialog}
          onOpenChange={(open) => {
            setShowAssignDialog(open);
            if (!open) {
              // After the dialog closes (whether saved or cancelled),
              // re-fetch the assignment so the UI reflects the new state.
              void queryClient.invalidateQueries({
                queryKey: ["zenstack", "CaseSharedDataSetAssignment"],
              });
            }
          }}
          caseId={caseId}
          projectId={projectId}
          hasOwnerDataset={hasOwnerDataset}
          currentAssignment={
            assignment
              ? {
                  sharedDataSetId: assignment.sharedDataSetId,
                  pinnedVersionId: assignment.pinnedVersionId,
                  mappingJson:
                    (assignment.mappingJson as Record<string, string>) ?? {},
                }
              : null
          }
          onSaved={() => {
            // After save, switch the view to Shared so the user sees the
            // mapped rows immediately (matches the dialog's intent).
            setViewSource("shared");
          }}
        />
      )}

      <AlertDialog
        open={showSwitchToLocalConfirm}
        onOpenChange={setShowSwitchToLocalConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("datasetSwitchToLocalTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("datasetSwitchToLocalDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmSwitchToLocal}
                data-testid="dataset-source-switch-confirm"
              >
                {t("datasetSwitchToLocalConfirm")}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function seedValueFor(
  row: DatasetRowRecord,
  columnId: string,
  parameters: ParameterRecord[]
): unknown {
  if (columnId === LABEL_COLUMN_ID) return row.label ?? "";
  const p = parameters.find((pp) => `param-${pp.id}` === columnId);
  if (!p) return "";
  return (row.valuesJson as Record<string, unknown> | null)?.[p.name] ?? "";
}
