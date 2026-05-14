import { TemplateListDisplay } from "@/components/tables/TemplateListDisplay";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CaseFields, Color, FieldIcon, FieldOptions } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { SquarePen, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

interface ExtendedFieldOptions extends FieldOptions {
  icon?: FieldIcon;
  iconColor?: Color;
}

export interface ExtendedCaseFields extends CaseFields {
  type: {
    id: number;
    type: string;
  };
  fieldOptions: {
    caseFieldId: number;
    fieldOptionId: number;
    fieldOption: ExtendedFieldOptions;
  }[];
  templates: {
    templateId: number;
    templateName: string;
  }[];
}

export const useColumns = (
  t: ReturnType<typeof useTranslations<"admin.templates.caseFields">>,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  handleToggle: (
    id: number,
    key: keyof ExtendedCaseFields,
    value: boolean
  ) => void,
  onEditCaseField?: (casefield: ExtendedCaseFields) => void,
  onDeleteCaseField?: (casefield: ExtendedCaseFields) => void
): ColumnDef<ExtendedCaseFields>[] =>
  useMemo(
    () => [
      {
        id: "displayName",
        accessorKey: "displayName",
        header: tCommon("fields.displayName"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        maxSize: 500,
        size: 350,
        cell: ({ row }) => row.original.displayName,
      },
      {
        id: "systemName",
        accessorKey: "systemName",
        header: tCommon("fields.systemName"),
        enableSorting: true,
        enableResizing: true,
        size: 150,
        cell: ({ row }) => row.original.systemName,
      },
      {
        id: "typeId",
        accessorKey: "typeId",
        header: tCommon("fields.fieldType"),
        enableSorting: false,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="whitespace-nowrap">{row.original.type.type}</div>
        ),
      },
      {
        id: "templates",
        accessorKey: "templates",
        header: tCommon("fields.templates"),
        enableSorting: false,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="text-center">
            <TemplateListDisplay templates={row.original.templates} />
          </div>
        ),
      },
      {
        id: "isEnabled",
        accessorKey: "isEnabled",
        header: tCommon("fields.enabled"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="text-center">
            <Switch
              checked={row.original.isEnabled}
              onCheckedChange={(checked) =>
                handleToggle(row.original.id, "isEnabled", checked)
              }
            />
          </div>
        ),
      },
      {
        id: "isRequired",
        accessorKey: "isRequired",
        header: tCommon("fields.required"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="text-center">
            <Switch
              checked={row.original.isRequired}
              onCheckedChange={(checked) =>
                handleToggle(row.original.id, "isRequired", checked)
              }
            />
          </div>
        ),
      },
      {
        id: "isRestricted",
        accessorKey: "isRestricted",
        header: tCommon("fields.restricted"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="text-center">
            <Switch
              checked={row.original.isRestricted}
              onCheckedChange={(checked) =>
                handleToggle(row.original.id, "isRestricted", checked)
              }
            />
          </div>
        ),
      },
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
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
              data-testid="edit-case-field-button"
              onClick={() => onEditCaseField?.(row.original)}
            >
              <SquarePen className="h-5 w-5" />
            </Button>
            <Button
              variant="destructive"
              className="px-2 py-1 h-auto"
              data-testid="delete-case-field-button"
              onClick={() => onDeleteCaseField?.(row.original)}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          </div>
        ),
      },
    ],
    [tCommon, handleToggle, onEditCaseField, onDeleteCaseField]
  );
