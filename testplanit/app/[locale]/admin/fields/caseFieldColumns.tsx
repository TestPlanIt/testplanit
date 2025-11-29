import { ColumnDef } from "@tanstack/react-table";
import { CaseFields, FieldIcon, FieldOptions, Color } from "@prisma/client";
import { Switch } from "@/components/ui/switch";
import { EditCaseFieldModal } from "./EditCaseField";
import { DeleteCaseFieldModal } from "./DeleteCaseField";
import { TemplateListDisplay } from "@/components/tables/TemplateListDisplay";
import { useTranslations } from "next-intl";

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

export const getColumns = (
  t: ReturnType<typeof useTranslations<"admin.templates.caseFields">>,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  session: any,
  handleToggle: (
    id: number,
    key: keyof ExtendedCaseFields,
    value: boolean
  ) => void
): ColumnDef<ExtendedCaseFields>[] => [
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
    header: tCommon("fields.actions"),
    enableResizing: true,
    enableSorting: false,
    enableHiding: false,
    meta: { isPinned: "right" },
    size: 120,
    cell: ({ row }) => (
      <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
        <EditCaseFieldModal
          key={`edit-${row.original.id}`}
          casefield={row.original}
        />
        <DeleteCaseFieldModal
          key={`delete-${row.original.id}`}
          casefield={row.original}
        />
      </div>
    ),
  },
];
