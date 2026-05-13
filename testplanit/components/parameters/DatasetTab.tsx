"use client";

import { DatasetCell } from "@/components/parameters/DatasetCell";
import { DatasetRowActions } from "@/components/parameters/DatasetRowActions";
import { PasteCsvDialog } from "@/components/parameters/PasteCsvDialog";
import { SheetEditingContext } from "@/components/parameters/ConfigureParametersSheet";
import { SortableDatasetRow } from "@/components/parameters/SortableDatasetRow";
import {
  glyphFromStatus,
  IterationStatusPip,
} from "@/components/iterations/IterationStatusPip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  ClipboardPaste,
  GripVertical,
  Lock,
  Plus,
  Table2,
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
import {
  useCountTestRunCases,
  useFindManyTestRunCaseIteration,
} from "~/lib/hooks";
import { useRouter } from "~/lib/navigation";
import {
  buildRowSchemaFromParameters,
  type ParameterShape,
} from "~/lib/schemas/datasetRowSchema";

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
}: DatasetTabProps) {
  const t = useTranslations("parameters");
  const queryClient = useQueryClient();
  const router = useRouter();
  const { setEditingCell } = useContext(SheetEditingContext);

  // ---------- Surface F: "Last result" cross-link column ----------
  // Cheap gate: only render the trailing column when this case has run history.
  const { data: runHistoryCount } = useCountTestRunCases({
    where: { repositoryCaseId: caseId },
  });
  const caseHasRunHistory = (runHistoryCount ?? 0) > 0;

  const { data: lastResultsRaw } = useFindManyTestRunCaseIteration(
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
  const [editCell, setEditCell] = useState<EditCellState | null>(null);
  const [draftValue, setDraftValue] = useState<unknown>(undefined);
  const [cellErrors, setCellErrors] = useState<Map<string, string>>(new Map());
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(new Set());
  const [showPasteDialog, setShowPasteDialog] = useState(false);

  const rows = dataset?.rows ?? [];
  const editCellRef = useRef<EditCellState | null>(null);
  editCellRef.current = editCell;

  // ---------- Dataset bootstrap ----------
  const loadDataset = useCallback(async () => {
    const res = await fetch(`/api/repository/cases/${caseId}/dataset`);
    if (!res.ok) return;
    const json = await res.json();
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
    }
  }, [caseId]);

  useEffect(() => {
    loadDataset();
  }, [loadDataset]);

  // ---------- Sheet edit-state coordination ----------
  useEffect(() => {
    setEditingCell(editCell !== null);
    return () => {
      setEditingCell(false);
    };
  }, [editCell, setEditingCell]);

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
      queryClient.invalidateQueries({ queryKey: ["zenstack", "DataSetRow"] });
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
    [patchRow, rowSchema, rows]
  );

  // ---------- Add row ----------
  const handleAddRow = useCallback(async () => {
    const nextIndex = rows.length;
    const res = await fetch(`/api/repository/cases/${caseId}/dataset/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowIndex: nextIndex,
        label: t("datasetRowDefaultLabel", { number: nextIndex + 1 }),
        valuesJson: {},
      }),
    });
    if (!res.ok) {
      toast.error(t("datasetSaveError"));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["zenstack", "DataSetRow"] });
    await loadDataset();
  }, [caseId, queryClient, rows.length, t, loadDataset]);

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
    // Optimistic update
    setDataset((prev) =>
      prev
        ? {
            ...prev,
            rows: reordered.map((r, idx) => ({ ...r, rowIndex: idx })),
          }
        : prev
    );
    await Promise.all(
      reordered.map((r, idx) =>
        fetch(`/api/repository/cases/${caseId}/dataset/rows`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId: r.id, rowIndex: idx }),
        })
      )
    );
    queryClient.invalidateQueries({ queryKey: ["zenstack", "DataSetRow"] });
  };

  // ---------- Build columns ----------
  const columns = useMemo<ColumnDef<DatasetRowRecord>[]>(() => {
    const cellHandlers = (
      rowId: number,
      columnId: string,
      paramName: string | null,
      currentValue: unknown
    ) => ({
      onEdit: () => {
        setEditCell({ rowId, columnId });
        setDraftValue(currentValue);
      },
      onChange: (v: unknown) => setDraftValue(v),
      onCommit: () => {
        commitCell(rowId, columnId, paramName, draftValue);
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
        header: () => null,
        cell: ({ row }) => (
          <div className="flex items-center justify-center">
            <Checkbox
              checked={selectedRowIds.has(row.original.id)}
              onCheckedChange={(v) =>
                setSelectedRowIds((prev) => {
                  const next = new Set(prev);
                  if (v) next.add(row.original.id);
                  else next.delete(row.original.id);
                  return next;
                })
              }
              aria-label={t("datasetRowSelectAria")}
              data-testid={`dataset-row-select-${row.original.id}`}
            />
          </div>
        ),
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
        return {
          id: colId,
          minSize: 180,
          header: () => (
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="font-mono text-sm">@{p.name}</span>
              <Badge variant="secondary">{p.type}</Badge>
              {p.sensitive ? (
                <Lock className="w-3 h-3 text-muted-foreground" />
              ) : null}
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
          const glyph = glyphFromStatus(entry.status, false);
          const handleClick = () => {
            router.push(
              `/projects/runs/${projectId}/${entry.runId}?iteration=${
                entry.rowIndex + 1
              }&selectedCase=${caseId}`
            );
          };
          return (
            <div className="flex items-center gap-2">
              <IterationStatusPip
                glyph={glyph}
                statusColor={entry.status.color?.value}
              />
              <Button
                variant="link"
                size="sm"
                onClick={handleClick}
                data-testid={`dataset-row-result-link-${row.original.rowIndex}`}
                className="p-0 h-auto"
              >
                {t("datasetRowResultLink", { status: entry.status.name })}
              </Button>
            </div>
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
  ]);

  const table = useReactTable<DatasetRowRecord>({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  // ---------- Render ----------
  if (!dataset) return null;

  const hasSelection = selectedRowIds.size > 0;

  return (
    <div className="flex flex-col h-full">
      <div
        className="p-4 border-b bg-card flex items-center justify-between"
        data-testid="dataset-tab-toolbar"
      >
        {hasSelection ? (
          <DatasetRowActions
            caseId={caseId}
            selectedRowIds={Array.from(selectedRowIds)}
            onClear={() => setSelectedRowIds(new Set())}
          />
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              {t("datasetCounts", {
                paramCount: parameters.length,
                rowCount: rows.length,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPasteDialog(true)}
                data-testid="dataset-paste-csv-button"
              >
                <ClipboardPaste className="w-4 h-4 mr-1" />
                {t("datasetPasteCsv")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenImportWizard?.()}
                data-testid="dataset-import-csv-button"
              >
                <Upload className="w-4 h-4 mr-1" />
                {t("datasetImportCsv")}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleAddRow}
                data-testid="dataset-add-row-button"
              >
                <Plus className="w-4 h-4 mr-1" />
                {t("datasetAddRow")}
              </Button>
            </div>
          </>
        )}
      </div>

      {rows.length === 0 ? (
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
          <div className="flex gap-2">
            <Button variant="default" size="sm" onClick={handleAddRow}>
              {t("datasetAddRow")}
            </Button>
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
          </div>
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
              <table className="w-full text-sm">
                <thead className="bg-muted/30 sticky top-0">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((h) => {
                        const minSize = h.column.columnDef.minSize;
                        return (
                          <th
                            key={h.id}
                            className="px-2 py-1 text-left"
                            style={
                              minSize ? { minWidth: `${minSize}px` } : undefined
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
                          <td className="w-6 px-2 py-1 align-middle">
                            <div
                              ref={setActivatorNodeRef}
                              {...listeners}
                              className="cursor-grab text-muted-foreground"
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
                              return (
                                <td
                                  key={cell.id}
                                  className="px-2 py-1 align-middle"
                                  style={
                                    minSize
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
        className="p-2 pl-4 border-t text-xs text-muted-foreground"
        data-testid="dataset-tab-footer"
      >
        {t("datasetFooterHint")}
      </div>

      <PasteCsvDialog
        open={showPasteDialog}
        onOpenChange={setShowPasteDialog}
        caseId={caseId}
        parameters={parameters}
      />
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
