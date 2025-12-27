import React, { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "~/lib/navigation";
import { useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Columns3, CirclePlus, CircleMinus } from "lucide-react";
import { Button } from "@/components/ui/button";

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

interface ColumnSelectionProps<TData> {
  columns: CustomColumnDef<TData>[];
  columnMetadata?: ColumnMetadata[];
  onVisibilityChange: (visibility: Record<string, boolean>) => void;
}

export function ColumnSelection<TData>({
  columns,
  columnMetadata,
  onVisibilityChange,
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
      const columnId = ("id" in item ? item.id : (item as CustomColumnDef<TData>).id) as string;
      const enableHiding = "enableHiding" in item ? item.enableHiding : (item as CustomColumnDef<TData>).enableHiding;
      const isVisible = "isVisible" in item ? item.isVisible : (item as CustomColumnDef<TData>).meta?.isVisible;

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

    if (columnVisibilityQuery) {
      const visibleColumns = columnVisibilityQuery.split(",");
      metadataSource.forEach((item, index) => {
        const columnId = ("id" in item ? item.id : (item as CustomColumnDef<TData>).id) as string;
        const enableHiding = "enableHiding" in item ? item.enableHiding : (item as CustomColumnDef<TData>).enableHiding;

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
  }, [metadataSource, columnVisibilityQuery]);

  const [columnVisibility, setColumnVisibility] =
    useState<Record<string, boolean>>(getInitialVisibility);

  useEffect(() => {
    onVisibilityChange(columnVisibility);
    // Skip URL update if no columns have changed from initial state
    const hasChanges = Object.entries(columnVisibility).some(
      ([key, value]) => value !== getInitialVisibility()[key]
    );
    if (!hasChanges) return;

    const visibleColumns = Object.keys(columnVisibility)
      .filter(
        (key) =>
          columnVisibility[key] &&
          metadataSource.findIndex((item) => {
            const itemId = "id" in item ? item.id : (item as CustomColumnDef<TData>).id;
            return itemId === key;
          }) !== 0 &&
          metadataSource.findIndex((item) => {
            const itemId = "id" in item ? item.id : (item as CustomColumnDef<TData>).id;
            return itemId === key;
          }) !== metadataSource.length - 1
      )
      .join(",");

    const query = new URLSearchParams(searchParams.toString());
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
    searchParams,
    metadataSource,
    getInitialVisibility,
    pathname,
  ]);

  const handleCheckboxChange = (columnId: string, isChecked: boolean) => {
    setColumnVisibility((prev) => {
      const newVisibility = { ...prev, [columnId]: isChecked };
      const anyVisible = Object.entries(newVisibility).some(
        ([id, visible]) => {
          if (!visible) return false;
          const item = metadataSource.find((item) => {
            const itemId = "id" in item ? item.id : (item as CustomColumnDef<TData>).id;
            return itemId === id;
          });
          const enableHiding = item && ("enableHiding" in item ? item.enableHiding : (item as CustomColumnDef<TData>).enableHiding);
          return enableHiding !== false;
        }
      );
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
      const itemId = ("id" in item ? item.id : (item as CustomColumnDef<TData>).id) as string;
      const enableHiding = "enableHiding" in item ? item.enableHiding : (item as CustomColumnDef<TData>).enableHiding;
      const label = "label" in item ? item.label :
        (typeof (item as CustomColumnDef<TData>).header === "string"
          ? (item as CustomColumnDef<TData>).header as string
          : "");

      return {
        id: itemId,
        label,
        enableHiding,
      };
    })
    .filter((item) => item.enableHiding !== false && item.id && item.label)
    .sort((a, b) => a.label.localeCompare(b.label));

  const midpoint = Math.ceil(displayColumns.length / 2);
  const leftColumns = displayColumns.slice(0, midpoint);
  const rightColumns = displayColumns.slice(midpoint);

  return (
    <Popover>
      <PopoverTrigger className="text-sm whitespace-nowrap flex items-center">
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
                  const isChecked = columnVisibility[columnId] ?? false;
                  return (
                    <div
                      key={columnId}
                      className="flex flex-row items-center space-x-1 min-w-0"
                    >
                      <Checkbox
                        id={columnId}
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          if (typeof checked === "boolean") {
                            handleCheckboxChange(columnId, checked);
                          }
                        }}
                      />
                      <label
                        htmlFor={columnId}
                        className="text-sm truncate cursor-pointer flex-1 max-w-[150px] overflow-hidden text-ellipsis"
                      >
                        {column.label}
                      </label>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col space-y-1 flex-1">
                {rightColumns.map((column) => {
                  const columnId = column.id;
                  const isChecked = columnVisibility[columnId] ?? false;
                  return (
                    <div
                      key={columnId}
                      className="flex flex-row items-center space-x-1 min-w-0"
                    >
                      <Checkbox
                        id={columnId}
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          if (typeof checked === "boolean") {
                            handleCheckboxChange(columnId, checked);
                          }
                        }}
                      />
                      <label
                        htmlFor={columnId}
                        className="text-sm truncate cursor-pointer flex-1 max-w-[150px] overflow-hidden text-ellipsis"
                      >
                        {column.label}
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
