"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { CustomColumnDef } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { CirclePlus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";
import { AddCaseFieldModal } from "./AddCaseField";
import { ExtendedCaseFields, useColumns } from "./caseFieldColumns";
import { DeleteCaseField } from "./DeleteCaseField";
import { EditCaseField } from "./EditCaseField";

export default function CaseFields() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.templates.caseFields");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [sortConfig, setSortConfig] = useState<
    | {
        column: string;
        direction: "asc" | "desc";
      }
    | undefined
  >({
    column: "displayName",
    direction: "asc",
  });

  const { mutateAsync: updateCaseField } =
    useClientQueries(schema).caseFields.useUpdate();

  // Stabilize mutation ref — ZenStack's mutateAsync changes identity every render
  const updateCaseFieldRef = useRef(updateCaseField);
  useEffect(() => {
    updateCaseFieldRef.current = updateCaseField;
  });

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig(undefined);
    } else {
      setSortConfig({ column, direction });
    }
  };

  const handleToggle = useCallback(
    async (id: number, key: keyof ExtendedCaseFields, value: boolean) => {
      try {
        await updateCaseFieldRef.current({
          where: { id },
          data: { [key]: value },
        });
      } catch (error) {
        console.error(`Failed to update ${key} for CaseField ${id}`, error);
      }
    },
    []
  );

  const { data: casefields, isLoading } = useClientQueries(
    schema
  ).caseFields.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { displayName: "asc" },
      include: {
        type: true,
        templates: true,
        fieldOptions: {
          include: {
            fieldOption: {
              include: {
                icon: true,
                iconColor: true,
              },
            },
          },
        },
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  const [editingCaseField, setEditingCaseField] =
    useState<ExtendedCaseFields | null>(null);
  const [deletingCaseField, setDeletingCaseField] =
    useState<ExtendedCaseFields | null>(null);

  const columns: CustomColumnDef<ExtendedCaseFields>[] = useColumns(
    t,
    tCommon,
    handleToggle,
    setEditingCaseField,
    setDeletingCaseField
  );

  const [addCaseFieldOpen, setAddCaseFieldOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const initialVisibility: Record<string, boolean> = {};
    columns.forEach((column) => {
      initialVisibility[column.id as string] = column.meta?.isVisible ?? true;
    });
    return initialVisibility;
  });

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN" && casefields) {
    return (
      <Card data-testid="case-fields-section">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle>{tGlobal("common.fields.caseFields")}</CardTitle>
              <HelpPopover helpKey="caseFields" />
            </SectionHeader>
            <Button
              data-testid="add-case-field-button"
              onClick={() => setAddCaseFieldOpen(true)}
              aria-label={t("add.title")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <CirclePlus className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                {t("add.title")}
              </span>
            </Button>
          </div>
          {addCaseFieldOpen && (
            <AddCaseFieldModal
              open={addCaseFieldOpen}
              onClose={() => setAddCaseFieldOpen(false)}
            />
          )}
        </CardHeader>
        <CardContent>
          <div className="flex justify-between">
            <DataTable
              columns={columns}
              data={casefields as any[]}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading}
              storageKey="admin-case-fields"
              onSortColumn={handleSortColumn}
            />
          </div>
        </CardContent>
        {editingCaseField && (
          <EditCaseField
            casefield={editingCaseField}
            open={true}
            onClose={() => setEditingCaseField(null)}
          />
        )}
        {deletingCaseField && (
          <DeleteCaseField
            casefield={deletingCaseField}
            open={true}
            onClose={() => setDeletingCaseField(null)}
          />
        )}
      </Card>
    );
  }
  return null;
}
