import { ProjectIcon } from "@/components/ProjectIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Configurations } from "~/zenstack/models";
import { ColumnDef } from "@tanstack/react-table";
import {
  Boxes,
  CircleCheckBig,
  CircleSlash2,
  Component,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useEffect, useMemo, useState } from "react";

export type ConfigWithVariants = Configurations & {
  variants: {
    variant: {
      id: number;
      name: string;
      isEnabled: boolean;
      categoryId: number;
    };
  }[];
  projects?: {
    projectId: number;
    project: { id: number; name: string; iconUrl: string | null };
  }[];
};

// Header checkbox with a shift-aware tooltip. Hovering shows the default
// "Select/Deselect all on this page" message; while Shift is held it switches
// to "across all pages" + the configuration count, matching the Cases table.
//
// Intentionally NOT React.memo'd: tanstack-table's `table` reference is stable
// across renders, so memoising would skip re-renders when the underlying
// selection state changes — leaving the checked indicator stale until some
// other prop happens to change.
function SelectAllCheckbox({
  table,
  handleSelectAllClick,
  selectAllLabel,
  totalItems,
  isAllFilteredSelected,
}: {
  table: any;
  handleSelectAllClick?: (event: React.MouseEvent) => void;
  selectAllLabel: string;
  totalItems: number;
  isAllFilteredSelected: boolean;
}) {
  const tAdmin = useTranslations("admin.configurations");
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftPressed(false);
    };
    const handleBlur = () => setIsShiftPressed(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const tooltipContent = isShiftPressed
    ? isAllFilteredSelected
      ? tAdmin("deselectAllShiftTooltip")
      : tAdmin("selectAllShiftTooltip", { count: totalItems })
    : tAdmin("selectAllTooltip");

  return (
    <TooltipProvider delayDuration={1000}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-pointer">
            <Checkbox
              checked={
                table.getIsAllPageRowsSelected() ||
                (table.getIsSomePageRowsSelected() && "indeterminate")
              }
              onCheckedChange={(value) => {
                if (!handleSelectAllClick)
                  table.toggleAllPageRowsSelected(!!value);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (handleSelectAllClick) {
                  e.preventDefault();
                  handleSelectAllClick(e);
                }
              }}
              aria-label={selectAllLabel}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          sideOffset={12}
          className="max-w-xs"
          style={{ zIndex: 9999 }}
        >
          <p className="text-xs">{tooltipContent}</p>
          {!isShiftPressed && (
            <p className="text-xs text-primary-foreground/65 mt-1">
              {tAdmin("shiftClickHint")}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const useColumns = (
  t: ReturnType<typeof useTranslations<"common">>,
  handleToggle: (id: number, isEnabled: boolean) => void,
  onEditConfiguration?: (config: ConfigWithVariants) => void,
  onDeleteConfiguration?: (config: ConfigWithVariants) => void,
  /** Shift-aware row selection handler. Plain click toggles; shift-click
   * range-selects from the last clicked row. */
  handleCheckboxClick?: (rowIndex: number, event: React.MouseEvent) => void,
  /** Shift-aware select-all handler. Plain click toggles the current page;
   * shift-click toggles ALL filtered rows across pages. */
  handleSelectAllClick?: (event: React.MouseEvent) => void,
  /** Total filtered count, used by the select-all tooltip when shift is held. */
  totalFilteredItems: number = 0,
  /** Whether every filtered row (across pages) is selected, used by the
   * shift+select-all tooltip to swap between "Select/Deselect all" copy. */
  isAllFilteredSelected: boolean = false
): ColumnDef<ConfigWithVariants>[] =>
  useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <SelectAllCheckbox
            table={table}
            handleSelectAllClick={handleSelectAllClick}
            selectAllLabel={t("actions.selectAll")}
            totalItems={totalFilteredItems}
            isAllFilteredSelected={isAllFilteredSelected}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => {
              if (!handleCheckboxClick) row.toggleSelected(!!value);
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (handleCheckboxClick) {
                e.preventDefault();
                handleCheckboxClick(row.index, e);
              }
            }}
            aria-label={t("actions.select")}
            data-testid={`config-checkbox-${row.original.id}`}
          />
        ),
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 40,
      },
      {
        id: "name",
        accessorKey: "name",
        accessorFn: (row) => row.name,
        header: t("name"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 500,
        cell: ({ row }) => {
          // Check if any variant is disabled
          const hasDisabledVariant = row.original.variants.some(
            ({ variant }) => !variant.isEnabled
          );

          return (
            <Label className="flex items-center space-x-2">
              <Switch
                checked={row.original.isEnabled}
                onCheckedChange={() =>
                  handleToggle(row.original.id, !row.original.isEnabled)
                }
                disabled={hasDisabledVariant}
              />
              <div
                className={
                  row.original.isEnabled ? "" : "text-muted-foreground"
                }
              >
                {row.original.name}
              </div>
            </Label>
          );
        },
      },
      {
        id: "variants",
        accessorKey: "variants",
        accessorFn: (row) => row.variants?.length ?? 0,
        header: t("fields.variants"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => {
          const hasVariants = row.original.variants.length > 0;
          return (
            <div className="text-center">
              {hasVariants && (
                <Popover>
                  <PopoverTrigger
                    className="cursor-default"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <Badge>
                      {" "}
                      <Component className="w-4 h-4 me-1" />
                      {row.original.variants.length}
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent>
                    {row.original.variants.map((variant) => (
                      <Badge key={variant.variant.id}>
                        {variant.variant.isEnabled ? (
                          <CircleCheckBig className="w-4 h-4" />
                        ) : (
                          <CircleSlash2 className="w-4 h-4 text-destructive" />
                        )}
                        <span className="ms-1">{variant.variant.name}</span>
                      </Badge>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          );
        },
      },
      {
        id: "projects",
        accessorFn: (row) => row.projects?.length ?? 0,
        header: t("fields.projects"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => {
          const projects = row.original.projects ?? [];
          return (
            <div className="text-center">
              {projects.length > 0 && (
                <Popover>
                  <PopoverTrigger
                    className="cursor-default"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <Badge>
                      <Boxes className="w-4 h-4 me-1" />
                      {projects.length}
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent className="flex flex-wrap gap-1">
                    {projects.map((p) => (
                      <Badge
                        key={p.projectId}
                        variant="secondary"
                        className="gap-1"
                      >
                        <ProjectIcon
                          iconUrl={p.project.iconUrl}
                          width={14}
                          height={14}
                        />
                        {p.project.name}
                      </Badge>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: t("actions.actionsLabel"),
        enableResizing: true,
        enableSorting: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 80,
        cell: ({ row }) => (
          <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
            <Button
              variant="ghost"
              className="px-2 py-1 h-auto"
              onClick={() => onEditConfiguration?.(row.original)}
              aria-label={t("actions.edit")}
            >
              <SquarePen className="h-5 w-5" />
            </Button>
            <Button
              variant="destructive"
              className="px-2 py-1 h-auto"
              onClick={() => onDeleteConfiguration?.(row.original)}
              aria-label={t("actions.delete")}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          </div>
        ),
      },
    ],
    [
      t,
      handleToggle,
      onEditConfiguration,
      onDeleteConfiguration,
      handleCheckboxClick,
      handleSelectAllClick,
      totalFilteredItems,
      isAllFilteredSelected,
    ]
  );
