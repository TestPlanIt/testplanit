"use client";

import { CustomColumnDef } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CirclePlus, LayoutList } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFindManyCaseFields, useUpdateCaseFields } from "~/lib/hooks";
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

  const { mutateAsync: updateCaseField } = useUpdateCaseFields();

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

  const { data: casefields, isLoading } = useFindManyCaseFields(
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
          <div className="flex items-center justify-between text-primary">
            <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
              <CardTitle>
                <div className="flex items-center">
                  <LayoutList className="mr-1" />
                  {tGlobal("common.fields.caseFields")}
                </div>
              </CardTitle>
            </div>
            <div>
              <Button
                data-testid="add-case-field-button"
                onClick={() => setAddCaseFieldOpen(true)}
              >
                <CirclePlus className="w-4" />
                <span className="hidden md:inline">{t("add.title")}</span>
              </Button>
              {addCaseFieldOpen && (
                <AddCaseFieldModal
                  open={addCaseFieldOpen}
                  onClose={() => setAddCaseFieldOpen(false)}
                />
              )}
            </div>
          </div>
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
