import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ColumnDef } from "@tanstack/react-table";
import { CircleMinus, CirclePlus, Columns3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "~/lib/navigation";

const COLUMN_VISIBILITY_STORAGE_PREFIX = "testplanit:columnVisibility:";

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
}

export function ColumnSelection<TData>({
  columns,
  columnMetadata,
  onVisibilityChange,
  storageKey,
}: ColumnSelectionProps<TData>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const columnVisibilityQuery = searchParams.get("columns");
  const t = useTranslations("common");
  const tGlobal = useTranslations();

  // Use columnMetadata if provided, otherwise fall back to columns
  const metadataSource = columnMetadata || columns;

  const getInitialVisibility = useCallback(() => {
    const initialVisibility: Record<string, boolean> = {};

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
        initialVisibility[columnId] = true;
      } else {
        // For other columns, use the existing logic
        if (index === 0 || index === metadataSource.length - 1) {
          initialVisibility[columnId] = true;
        } else {
          initialVisibility[columnId] = isVisible ?? true;
        }
      }
    });

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
  }, [metadataSource, columnVisibilityQuery, storageKey]);

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
    router.push(url, { scroll: false });
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

  return (
    <Popover>
      <PopoverTrigger
        className="text-sm whitespace-nowrap flex items-center"
        data-testid="column-selection-trigger"
      >
        <Columns3 className="w-4 h-4 mr-1" />
        {t("table.columns.columns")}
      </PopoverTrigger>
      <PopoverContent className="w-fit grid max-w-sm">
        <div className="space-y-1">
          <div className="flex justify-between mb-2">
            <Button onClick={handleSelectAll} variant="ghost">
              <CirclePlus className="w-4 h-4 shrink-0" />
              {tGlobal("common.actions.selectAll")}
            </Button>
            <Button onClick={handleSelectNone} variant="ghost">
              <CircleMinus className="w-4 h-4 shrink-0" />
              {t("table.selectNone")}
            </Button>
          </div>
          <ScrollArea className="h-[300px]">
            <div className="flex gap-2 pr-4">
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
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}
