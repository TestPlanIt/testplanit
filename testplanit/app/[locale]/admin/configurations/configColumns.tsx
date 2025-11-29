import { ColumnDef } from "@tanstack/react-table";
import { Configurations } from "@prisma/client";
import { useTranslations } from "next-intl";
import { EditConfigurationModal } from "./EditConfig";
import { DeleteConfigurationModal } from "./DeleteConfig";
import { CircleCheckBig, CircleSlash2, Component } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type ConfigWithVariants = Configurations & {
  variants: {
    variant: {
      id: number;
      name: string;
      isEnabled: boolean;
      categoryId: number;
    };
  }[];
};

export const getColumns = (
  t: ReturnType<typeof useTranslations<"common">>,
  handleToggle: (id: number, isEnabled: boolean) => void
): ColumnDef<ConfigWithVariants>[] => [
  {
    id: "name",
    accessorKey: "name",
    accessorFn: (row) => row.name,
    header: t("fields.name"),
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
            className={row.original.isEnabled ? "" : "text-muted-foreground"}
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
    accessorFn: (row) => row.name,
    header: t("fields.variants"),
    enableSorting: false,
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
                  <Component className="w-4 h-4 mr-1" />
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
                    <span className="ml-1">{variant.variant.name}</span>
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
    header: t("fields.actions"),
    enableResizing: true,
    enableSorting: false,
    enableHiding: false,
    meta: { isPinned: "right" },
    size: 120,
    cell: ({ row }) => (
      <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
        <EditConfigurationModal
          key={`edit-${row.original.id}`}
          configuration={row.original}
        />
        <DeleteConfigurationModal
          key={`delete-${row.original.id}`}
          configuration={row.original}
        />
      </div>
    ),
  },
];
