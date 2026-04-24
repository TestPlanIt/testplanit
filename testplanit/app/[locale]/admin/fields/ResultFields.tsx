"use client";

import { CustomColumnDef } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CirclePlus, SquareCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFindManyResultFields, useUpdateResultFields } from "~/lib/hooks";
import { useRouter } from "~/lib/navigation";
import { AddResultFieldModal } from "./AddResultField";
import { DeleteResultField } from "./DeleteResultField";
import { EditResultField } from "./EditResultField";
import { ExtendedResultFields, getColumns } from "./resultFieldColumns";

export default function ResultFields() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.templates.resultFields");
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

  const { mutateAsync: updateResultField } = useUpdateResultFields();

  // Stabilize mutation ref — ZenStack's mutateAsync changes identity every render
  const updateResultFieldRef = useRef(updateResultField);
  useEffect(() => {
    updateResultFieldRef.current = updateResultField;
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
    async (id: number, key: keyof ExtendedResultFields, value: boolean) => {
      try {
        await updateResultFieldRef.current({
          where: { id },
          data: { [key]: value },
        });
      } catch (error) {
        console.error(`Failed to update ${key} for ResultField ${id}`, error);
      }
    },
    []
  );

  const { data: resultfields, isLoading } = useFindManyResultFields(
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

  const [editingResultField, setEditingResultField] =
    useState<ExtendedResultFields | null>(null);
  const [deletingResultField, setDeletingResultField] =
    useState<ExtendedResultFields | null>(null);

  const columns: CustomColumnDef<ExtendedResultFields>[] = useMemo(
    () =>
      getColumns(
        t,
        tCommon,
        // eslint-disable-next-line react-hooks/refs
        handleToggle,
        setEditingResultField,
        setDeletingResultField
      ),
    [handleToggle, t, tCommon]
  );

  const [addResultFieldOpen, setAddResultFieldOpen] = useState(false);
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

  if (session && session.user.access === "ADMIN" && resultfields) {
    return (
      <Card data-testid="result-fields-section">
        <CardHeader>
          <div className="flex items-center justify-between text-primary">
            <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
              <CardTitle>
                <div className="flex items-center">
                  <SquareCheck className="mr-1" />
                  {tGlobal("common.fields.resultFields")}
                </div>
              </CardTitle>{" "}
            </div>
            <div>
              <Button
                data-testid="add-result-field-button"
                onClick={() => setAddResultFieldOpen(true)}
              >
                <CirclePlus className="w-4" />
                <span className="hidden md:inline">{t("add.title")}</span>
              </Button>
              {addResultFieldOpen && (
                <AddResultFieldModal
                  open={addResultFieldOpen}
                  onClose={() => setAddResultFieldOpen(false)}
                />
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between">
            <DataTable
              columns={columns}
              data={resultfields as any[]}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading}
            />
          </div>
        </CardContent>
        {editingResultField && (
          <EditResultField
            resultfield={editingResultField}
            open={true}
            onClose={() => setEditingResultField(null)}
          />
        )}
        {deletingResultField && (
          <DeleteResultField
            resultfield={deletingResultField}
            open={true}
            onClose={() => setDeletingResultField(null)}
          />
        )}
      </Card>
    );
  }
  return null;
}
