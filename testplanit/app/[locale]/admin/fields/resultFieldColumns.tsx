import { ColumnDef } from "@tanstack/react-table";
import { ResultFields, FieldIcon, FieldOptions, Color } from "@prisma/client";
import { Switch } from "@/components/ui/switch";
import { EditResultFieldModal } from "./EditResultField";
import { DeleteResultFieldModal } from "./DeleteResultField";
import { TemplateListDisplay } from "@/components/tables/TemplateListDisplay";
import { useTranslations } from "next-intl";

interface ExtendedFieldOptions extends FieldOptions {
  icon?: FieldIcon;
  iconColor?: Color;
}

export interface ExtendedResultFields extends ResultFields {
  type: {
    id: number;
    type: string;
  };
  fieldOptions: {
    resultFieldId: number;
    fieldOptionId: number;
    fieldOption: ExtendedFieldOptions;
  }[];
  templates: {
    templateId: number;
    templateName: string;
  }[];
}

export const getColumns = (
  t: ReturnType<typeof useTranslations<"common">>,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  session: any,
  handleToggle: (
    id: number,
    key: keyof ExtendedResultFields,
    value: boolean
  ) => void
): ColumnDef<ExtendedResultFields>[] => {
  return [
    {
      id: "displayName",
      accessorKey: "displayName",
      header: tCommon("fields.displayName"),
      enableSorting: true,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "left" },
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
      size: 120,
      cell: ({ row }) => (
        <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
          <EditResultFieldModal
            key={`edit-${row.original.id}`}
            resultfield={row.original}
          />
          <DeleteResultFieldModal
            key={`delete-${row.original.id}`}
            resultfield={row.original}
          />
        </div>
      ),
    },
  ];
};
