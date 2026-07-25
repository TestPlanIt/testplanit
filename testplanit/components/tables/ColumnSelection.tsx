import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ColumnDef } from "@tanstack/react-table";
import { Columns3, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "~/lib/navigation";

const COLUMN_VISIBILITY_STORAGE_PREFIX = "testplanit:columnVisibility:";
const COLUMN_ORDER_STORAGE_PREFIX = "testplanit:columnOrder:";
const COLUMN_WIDTH_STORAGE_PREFIX = "testplanit:columnWidth:";
const COLUMN_SORT_STORAGE_PREFIX = "testplanit:columnSort:";

export type StoredColumnSort = { column: string; direction: "asc" | "desc" };

/**
 * Read the remembered column visibility map for a view. Returns null when
 * nothing is stored, when running on the server, or when the stored value is
 * unusable. Callers only apply keys for columns that exist in the current
 * view, so stale keys for columns that no longer exist are ignored.
 */
export function readStoredColumnVisibility(
  storageKey?: string
): Record<string, boolean> | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      `${COLUMN_VISIBILITY_STORAGE_PREFIX}${storageKey}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") result[key] = value;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Persist column visibility for a view, merging with any previously-saved map
 * so choices for columns not currently present (e.g. fields from a different
 * template) are preserved across views that share a storage key.
 */
export function writeStoredColumnVisibility(
  storageKey: string,
  visibility: Record<string, boolean>
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readStoredColumnVisibility(storageKey) ?? {};
    const merged = { ...existing, ...visibility };
    window.localStorage.setItem(
      `${COLUMN_VISIBILITY_STORAGE_PREFIX}${storageKey}`,
      JSON.stringify(merged)
    );
  } catch {
    // ignore storage errors (quota exceeded, private browsing, etc.)
  }
}

/**
 * Read the remembered column order for a view — a total, ordered list of column
 * ids. Returns null when nothing is stored, on the server, or when unusable.
 * Callers reconcile against the columns currently present, so stale ids are
 * dropped and newly-added columns are spliced in at their natural position.
 */
export function readStoredColumnOrder(storageKey?: string): string[] | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      `${COLUMN_ORDER_STORAGE_PREFIX}${storageKey}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const result = parsed.filter((id): id is string => typeof id === "string");
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Persist column order for a view. Order is a total list, so this replaces the
 * stored value rather than merging (unlike widths and visibility).
 */
export function writeStoredColumnOrder(
  storageKey: string,
  order: string[]
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${COLUMN_ORDER_STORAGE_PREFIX}${storageKey}`,
      JSON.stringify(order)
    );
  } catch {
    // ignore storage errors (quota exceeded, private browsing, etc.)
  }
}

/**
 * Read the remembered column widths (column id -> pixels) for a view. Returns
 * null when nothing is stored, on the server, or when unusable. Widths for
 * columns not currently present are ignored by the table, which falls back to
 * the column def size.
 */
export function readStoredColumnWidths(
  storageKey?: string
): Record<string, number> | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      `${COLUMN_WIDTH_STORAGE_PREFIX}${storageKey}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Persist column widths for a view. Merges with any previously-saved map so
 * widths for columns from a different template that shares this storage key
 * survive. Pass `presentColumnIds` (the columns currently in view) so a width
 * that was reset — absent from `widths` — is cleared rather than re-loaded from
 * the old stored value.
 */
export function writeStoredColumnWidths(
  storageKey: string,
  widths: Record<string, number>,
  presentColumnIds?: string[]
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readStoredColumnWidths(storageKey) ?? {};
    let base = existing;
    if (presentColumnIds) {
      // Drop stored widths for columns currently in view so a reset clears them,
      // while keeping widths for columns from other templates sharing this key.
      const present = new Set(presentColumnIds);
      base = Object.fromEntries(
        Object.entries(existing).filter(([id]) => !present.has(id))
      );
    }
    const merged = { ...base, ...widths };
    window.localStorage.setItem(
      `${COLUMN_WIDTH_STORAGE_PREFIX}${storageKey}`,
      JSON.stringify(merged)
    );
  } catch {
    // ignore storage errors (quota exceeded, private browsing, etc.)
  }
}

/**
 * Read the remembered sort (column + direction) for a view. Returns null when
 * nothing is stored, on the server, or when unusable. The caller decides
 * whether the stored column still exists in the current view.
 */
export function readStoredColumnSort(
  storageKey?: string
): StoredColumnSort | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      `${COLUMN_SORT_STORAGE_PREFIX}${storageKey}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const { column, direction } = parsed as Record<string, unknown>;
    if (
      typeof column === "string" &&
      column.length > 0 &&
      (direction === "asc" || direction === "desc")
    ) {
      return { column, direction };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist the sort for a view. Pass `null` to clear it (e.g. when the table
 * returns to its default order), so a reload restores the default rather than a
 * stale sort.
 */
export function writeStoredColumnSort(
  storageKey: string,
  sort: StoredColumnSort | null
): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${COLUMN_SORT_STORAGE_PREFIX}${storageKey}`;
    if (sort === null) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(sort));
  } catch {
    // ignore storage errors (quota exceeded, private browsing, etc.)
  }
}

export interface CustomColumnMeta {
  isVisible?: boolean;
  isPinned?: "left" | "right";
}

export type CustomColumnDef<TData> = ColumnDef<TData, unknown> & {
  meta?: CustomColumnMeta;
};

// Lightweight column metadata for selection UI
export interface ColumnMetadata {
  id: string;
  label: string;
  isVisible?: boolean;
  enableHiding?: boolean;
}

/**
 * Fallback label for columns whose header is a function (returns JSX) so we
 * can't read a plain string. "lastUsedAt" -> "Last Used At", "name" -> "Name".
 */
function humanizeColumnId(id: string): string {
  if (!id) return "";
  const spaced = id.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface ColumnSelectionProps<TData> {
  columns: CustomColumnDef<TData>[];
  columnMetadata?: ColumnMetadata[];
  onVisibilityChange: (visibility: Record<string, boolean>) => void;
  /**
   * Stable identifier for this table view. When provided, the user's column
   * choices are remembered in localStorage and restored on return. Must be
   * unique per view and stable across renders (e.g. include the projectId so
   * each project's repository remembers its own columns).
   */
  storageKey?: string;
  /**
   * Optional out-param. This control assigns a `hideColumn(id)` function to the
   * ref's `current` so an outside affordance (e.g. a "Hide column" action in the
   * table header) can hide a column through this control's own state — the same
   * path as unchecking its checkbox, so it persists and the checkbox stays in
   * sync. Left undefined by callers that don't need it.
   */
  hideColumnRef?: MutableRefObject<((columnId: string) => void) | null>;
}

export function ColumnSelection<TData>({
  columns,
  columnMetadata,
  onVisibilityChange,
  storageKey,
  hideColumnRef,
}: ColumnSelectionProps<TData>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const columnVisibilityQuery = searchParams.get("columns");
  const t = useTranslations("common");
  const tGlobal = useTranslations();

  // Use columnMetadata if provided, otherwise fall back to columns
  const metadataSource = columnMetadata || columns;

  // The default visibility from the column definitions alone: required columns
  // and the first/last columns are always visible; others use their own default
  // (isVisible ?? true). Ignores remembered choices and the shared-link URL, so
  // the reset action can restore the out-of-the-box layout.
  const getDefaultVisibility = useCallback(() => {
    const defaultVisibility: Record<string, boolean> = {};

    metadataSource.forEach((item, index) => {
      const columnId = (
        "id" in item ? item.id : (item as CustomColumnDef<TData>).id
      ) as string;
      const enableHiding =
        "enableHiding" in item
          ? item.enableHiding
          : (item as CustomColumnDef<TData>).enableHiding;
      const isVisible =
        "isVisible" in item
          ? item.isVisible
          : (item as CustomColumnDef<TData>).meta?.isVisible;

      if (!columnId) return;

      // Always show columns that cannot be hidden
      if (enableHiding === false) {
        defaultVisibility[columnId] = true;
      } else if (index === 0 || index === metadataSource.length - 1) {
        // First and last columns are always visible
        defaultVisibility[columnId] = true;
      } else {
        defaultVisibility[columnId] = isVisible ?? true;
      }
    });

    return defaultVisibility;
  }, [metadataSource]);

  const getInitialVisibility = useCallback(() => {
    const initialVisibility = getDefaultVisibility();

    // Overlay remembered choices from localStorage. Lower precedence than the
    // URL param below (an explicit shared link wins). Only keys for columns
    // present in this view are applied, so a stored column that no longer
    // exists in the view is ignored.
    const storedVisibility = readStoredColumnVisibility(storageKey);
    if (storedVisibility) {
      metadataSource.forEach((item, index) => {
        const columnId = (
          "id" in item ? item.id : (item as CustomColumnDef<TData>).id
        ) as string;
        const enableHiding =
          "enableHiding" in item
            ? item.enableHiding
            : (item as CustomColumnDef<TData>).enableHiding;

        if (!columnId) return;
        // Never let storage hide always-visible or first/last columns
        if (enableHiding === false) return;
        if (index === 0 || index === metadataSource.length - 1) return;
        if (typeof storedVisibility[columnId] === "boolean") {
          initialVisibility[columnId] = storedVisibility[columnId];
        }
      });
    }

    if (columnVisibilityQuery) {
      const visibleColumns = columnVisibilityQuery.split(",");
      metadataSource.forEach((item, index) => {
        const columnId = (
          "id" in item ? item.id : (item as CustomColumnDef<TData>).id
        ) as string;
        const enableHiding =
          "enableHiding" in item
            ? item.enableHiding
            : (item as CustomColumnDef<TData>).enableHiding;

        if (!columnId) return;

        // Skip columns that cannot be hidden
        if (enableHiding === false) {
          return;
        }
        // Skip first and last columns
        if (index !== 0 && index !== metadataSource.length - 1) {
          initialVisibility[columnId] = visibleColumns.includes(columnId);
        }
      });
    }

    return initialVisibility;
  }, [getDefaultVisibility, metadataSource, columnVisibilityQuery, storageKey]);

  const [columnVisibility, setColumnVisibility] =
    useState<Record<string, boolean>>(getInitialVisibility);

  // Snapshot the mount-time initial visibility once, as a stable baseline for
  // URL change-detection. Recomputing getInitialVisibility() in the URL effect
  // would re-read localStorage *after* the persist effect writes it, so every
  // change would look like "no change" and the shareable ?columns= URL would
  // stop updating once a storageKey is set.
  const initialVisibilityRef = useRef<Record<string, boolean> | null>(null);
  if (initialVisibilityRef.current === null) {
    initialVisibilityRef.current = columnVisibility;
  }

  // Remember the user's choices for this view. Skip the first render so we only
  // persist deliberate changes (not the computed defaults or a shared-link URL
  // state), then write on every subsequent change. Merging happens in the
  // writer so choices for columns from other views/templates are preserved.
  const hasPersistedRef = useRef(false);
  useEffect(() => {
    if (!storageKey) return;
    if (!hasPersistedRef.current) {
      hasPersistedRef.current = true;
      return;
    }
    writeStoredColumnVisibility(storageKey, columnVisibility);
  }, [storageKey, columnVisibility]);

  // Expose a hide-a-column function to an outside affordance (the header "Hide
  // column" menu) via the ref out-param. It drives this control's own state —
  // exactly like unchecking the column's checkbox — so the change persists and
  // the checkbox stays in sync, and it flows to the table one-way (through
  // onVisibilityChange) with no feedback loop.
  useEffect(() => {
    if (!hideColumnRef) return;
    hideColumnRef.current = (columnId: string) => {
      setColumnVisibility((prev) => ({ ...prev, [columnId]: false }));
    };
    return () => {
      hideColumnRef.current = null;
    };
  }, [hideColumnRef]);

  // Fold newly-present columns into the visibility map when the column set grows
  // — e.g. custom-field columns whose template data loads after mount. Without
  // this, a column absent at mount never receives its remembered choice, so a
  // "select all" made earlier wouldn't apply to it and it would fall back to its
  // (hidden) default. Uses the stored choice when there is one, else the
  // column's own default; already-known columns are left untouched.
  useEffect(() => {
    setColumnVisibility((prev) => {
      const stored = readStoredColumnVisibility(storageKey);
      const next = { ...prev };
      let changed = false;
      metadataSource.forEach((item, index) => {
        const columnId = (
          "id" in item ? item.id : (item as CustomColumnDef<TData>).id
        ) as string;
        if (!columnId || columnId in next) return;
        const enableHiding =
          "enableHiding" in item
            ? item.enableHiding
            : (item as CustomColumnDef<TData>).enableHiding;
        const isVisible =
          "isVisible" in item
            ? item.isVisible
            : (item as CustomColumnDef<TData>).meta?.isVisible;
        if (
          enableHiding === false ||
          index === 0 ||
          index === metadataSource.length - 1
        ) {
          next[columnId] = true;
        } else if (stored && typeof stored[columnId] === "boolean") {
          next[columnId] = stored[columnId];
        } else {
          next[columnId] = isVisible ?? true;
        }
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [metadataSource, storageKey]);

  useEffect(() => {
    onVisibilityChange(columnVisibility);
    // Skip URL update if no columns have changed from the mount-time initial
    // state. Compare against the stable snapshot (not getInitialVisibility(),
    // which would re-read storage written by the persist effect and mask the
    // change), so the ?columns= URL stays in sync with the selection.
    const initialVisibility = initialVisibilityRef.current ?? {};
    const hasChanges = Object.entries(columnVisibility).some(
      ([key, value]) => value !== initialVisibility[key]
    );
    if (!hasChanges) return;

    const visibleColumns = Object.keys(columnVisibility)
      .filter(
        (key) =>
          columnVisibility[key] &&
          metadataSource.findIndex((item) => {
            const itemId =
              "id" in item ? item.id : (item as CustomColumnDef<TData>).id;
            return itemId === key;
          }) !== 0 &&
          metadataSource.findIndex((item) => {
            const itemId =
              "id" in item ? item.id : (item as CustomColumnDef<TData>).id;
            return itemId === key;
          }) !==
            metadataSource.length - 1
      )
      .join(",");

    // Use window.location.search instead of searchParams.toString() to get
    // the actual current URL. searchParams can lag behind pushState updates
    // (especially in dev mode), causing stale params to overwrite correct values.
    const query = new URLSearchParams(window.location.search);
    const currentColumns = query.get("columns");
    const newColumns = visibleColumns === "" ? "none" : visibleColumns;

    // Skip URL update if columns haven't changed
    if (currentColumns === newColumns) {
      return;
    }

    query.set("columns", newColumns);
    const url = `${pathname}?${query.toString()}`;
    // replace, not push: this effect mirrors column-visibility state into the
    // URL (including the initial default set on load). A push adds a history
    // entry per sync, so leaving the page takes two Back clicks.
    router.replace(url, { scroll: false });
  }, [
    columnVisibility,
    onVisibilityChange,
    router,
    columnVisibilityQuery,
    metadataSource,
    pathname,
  ]);

  const handleCheckboxChange = (columnId: string, isChecked: boolean) => {
    setColumnVisibility((prev) => {
      const newVisibility = { ...prev, [columnId]: isChecked };
      const anyVisible = Object.entries(newVisibility).some(([id, visible]) => {
        if (!visible) return false;
        const item = metadataSource.find((item) => {
          const itemId =
            "id" in item ? item.id : (item as CustomColumnDef<TData>).id;
          return itemId === id;
        });
        const enableHiding =
          item &&
          ("enableHiding" in item
            ? item.enableHiding
            : (item as CustomColumnDef<TData>).enableHiding);
        return enableHiding !== false;
      });
      if (!anyVisible) {
        newVisibility[columnId] = true; // Ensure at least one column is always visible
      }
      return newVisibility;
    });
  };

  const handleSelectAll = () => {
    const newVisibility: Record<string, boolean> = {};
    displayColumns.forEach((item) => {
      newVisibility[item.id] = true;
    });
    setColumnVisibility(newVisibility);
  };

  const handleSelectNone = () => {
    const newVisibility: Record<string, boolean> = {};
    displayColumns.forEach((item) => {
      // Keep columns with enableHiding set to false visible
      newVisibility[item.id] = item.enableHiding === false;
    });
    setColumnVisibility(newVisibility);
  };

  // Restore the out-of-the-box column layout, discarding remembered choices. The
  // persist and URL effects then overwrite the stored map and ?columns= param
  // with these defaults, so the reset sticks across reloads and shared links.
  const handleReset = () => {
    setColumnVisibility(getDefaultVisibility());
  };

  const displayColumns = metadataSource
    .map((item) => {
      const itemId = (
        "id" in item ? item.id : (item as CustomColumnDef<TData>).id
      ) as string;
      const enableHiding =
        "enableHiding" in item
          ? item.enableHiding
          : (item as CustomColumnDef<TData>).enableHiding;
      // Function-style headers (header: () => <JSX/>) can't be stringified;
      // fall back to a humanized column id so the column still appears in
      // the selector instead of disappearing silently.
      const rawLabel =
        "label" in item
          ? item.label
          : typeof (item as CustomColumnDef<TData>).header === "string"
            ? ((item as CustomColumnDef<TData>).header as string)
            : "";
      const label = rawLabel || humanizeColumnId(itemId);

      return {
        id: itemId,
        label,
        enableHiding,
        isRequired: enableHiding === false,
      };
    })
    .filter((item) => item.id && item.label)
    .sort((a, b) => a.label.localeCompare(b.label));

  const midpoint = Math.ceil(displayColumns.length / 2);
  const leftColumns = displayColumns.slice(0, midpoint);
  const rightColumns = displayColumns.slice(midpoint);

  // Tri-state for the "Select All" checkbox, over the toggleable (non-required)
  // columns: checked when all are visible, unchecked when none are, and
  // indeterminate when only some are. Required columns are always visible and
  // don't factor into the state.
  const toggleableColumns = displayColumns.filter(
    (column) => !column.isRequired
  );
  const visibleToggleableCount = toggleableColumns.filter(
    (column) => columnVisibility[column.id] ?? false
  ).length;
  const selectAllChecked: boolean | "indeterminate" =
    toggleableColumns.length > 0 &&
    visibleToggleableCount === toggleableColumns.length
      ? true
      : visibleToggleableCount > 0
        ? "indeterminate"
        : false;

  return (
    <Popover>
      <PopoverTrigger
        className="text-sm whitespace-nowrap flex items-center"
        data-testid="column-selection-trigger"
      >
        <Columns3 className="w-4 h-4 me-1" />
        {t("table.columns.columns")}
      </PopoverTrigger>
      <PopoverContent className="w-fit grid max-w-sm">
        <div className="space-y-1">
          <div className="flex flex-row items-center justify-between mb-2">
            <div className="flex flex-row items-center space-x-1 min-w-0">
              <Checkbox
                id="column-selection-select-all"
                checked={selectAllChecked}
                onCheckedChange={(checked) => {
                  if (checked === true) {
                    handleSelectAll();
                  } else {
                    handleSelectNone();
                  }
                }}
              />
              <label
                htmlFor="column-selection-select-all"
                className="text-sm font-medium cursor-pointer"
              >
                {tGlobal("common.actions.selectAll")}
              </label>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleReset}
              className="h-6 w-6 shrink-0 text-muted-foreground"
              aria-label={t("table.columns.resetColumns")}
              title={t("table.columns.resetColumns")}
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
          <div className="max-h-[300px] flex gap-2 pe-4 overflow-y-auto">
            <div className="flex flex-col space-y-1 flex-1">
              {leftColumns.map((column) => {
                const columnId = column.id;
                const isChecked =
                  column.isRequired || (columnVisibility[columnId] ?? false);
                return (
                  <div
                    key={columnId}
                    className="flex flex-row items-center space-x-1 min-w-0"
                  >
                    <Checkbox
                      id={columnId}
                      checked={isChecked}
                      disabled={column.isRequired}
                      onCheckedChange={(checked) => {
                        if (typeof checked === "boolean") {
                          handleCheckboxChange(columnId, checked);
                        }
                      }}
                    />
                    <label
                      htmlFor={columnId}
                      className={`text-sm truncate cursor-pointer flex-1 max-w-[150px] overflow-hidden text-ellipsis${column.isRequired ? " text-muted-foreground" : ""}`}
                    >
                      {column.label}{" "}
                      {column.isRequired && t("table.columns.required")}
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-col space-y-1 flex-1">
              {rightColumns.map((column) => {
                const columnId = column.id;
                const isChecked =
                  column.isRequired || (columnVisibility[columnId] ?? false);
                return (
                  <div
                    key={columnId}
                    className="flex flex-row items-center space-x-1 min-w-0"
                  >
                    <Checkbox
                      id={columnId}
                      checked={isChecked}
                      disabled={column.isRequired}
                      onCheckedChange={(checked) => {
                        if (typeof checked === "boolean") {
                          handleCheckboxChange(columnId, checked);
                        }
                      }}
                    />
                    <label
                      htmlFor={columnId}
                      className={`text-sm truncate cursor-pointer flex-1 max-w-[150px] overflow-hidden text-ellipsis${column.isRequired ? " text-muted-foreground" : ""}`}
                    >
                      {column.label}{" "}
                      {column.isRequired && t("table.columns.required")}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
