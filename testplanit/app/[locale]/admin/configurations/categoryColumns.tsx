import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { ConfigCategories } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  CircleSlash2,
  Component,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";

export type ConfigCategoryWithVariants = ConfigCategories & {
  variants: {
    id?: number;
    name: string;
    isEnabled: boolean;
    categoryId: number;
  }[];
};

export const getColumns = (
  tCommon: ReturnType<typeof useTranslations<"common">>,
  onEditCategory?: (category: ConfigCategoryWithVariants) => void,
  onDeleteCategory?: (category: ConfigCategoryWithVariants) => void
): ColumnDef<ConfigCategoryWithVariants>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: tCommon("name"),
    enableSorting: true,
    enableResizing: true,
    enableHiding: false,
    meta: { isPinned: "left" },
    size: 500,
    cell: ({ row }) => {
      return (
        <div
          onClick={(e) => {
            e.stopPropagation();
            row.toggleExpanded();
          }}
          className="flex items-center cursor-pointer"
        >
          <button
            className="mr-2"
            onClick={(e) => {
              e.stopPropagation();
              row.toggleExpanded();
            }}
            aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
          >
            {row.getIsExpanded() ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
          </button>
          <span>{row.original.name}</span>
        </div>
      );
    },
  },
  {
    id: "variants",
    accessorKey: "variants",
    accessorFn: (row) => row.variants,
    header: tCommon("fields.variants"),
    enableSorting: false,
    enableResizing: true,
    enableHiding: false,
    size: 100,
    cell: ({ row }) => {
      const hasVariants = row.original.variants.length > 0;
      if (!hasVariants) return null;
      return (
        <div className="text-center">
          <Popover>
            <PopoverTrigger
              className="cursor-default"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <Badge>
                <Component className="w-4 h-4 mr-1" />
                {row.original.variants.length}
              </Badge>
            </PopoverTrigger>
            <PopoverContent>
              {row.original.variants.map((variant) => (
                <Badge key={variant.id}>
                  {variant.isEnabled ? (
                    <CircleCheckBig className="w-4 h-4" />
                  ) : (
                    <CircleSlash2 className="w-4 h-4 text-destructive" />
                  )}
                  <span className="ml-1">{variant.name}</span>
                </Badge>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      );
    },
  },
  {
    id: "actions",
    header: tCommon("actions.actionsLabel"),
    enableSorting: false,
    enableResizing: true,
    enableHiding: false,
    meta: { isPinned: "right" },
    size: 80,
    cell: ({ row }) => (
      <div
        className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <Button
          variant="ghost"
          className="px-2 py-1 h-auto"
          onClick={() => onEditCategory?.(row.original)}
        >
          <SquarePen className="h-5 w-5" />
        </Button>
        <Button
          variant="destructive"
          className="px-2 py-1 h-auto"
          onClick={() => onDeleteCategory?.(row.original)}
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      </div>
    ),
  },
];
