"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useFindManyCaseFields, useUpdateCaseFields } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns, ExtendedCaseFields } from "./caseFieldColumns";
import { CustomColumnDef } from "@/components/tables/ColumnSelection";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AddCaseFieldModal } from "./AddCaseField";
import { LayoutList } from "lucide-react";
import { useTranslations } from "next-intl";

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
        await updateCaseField({
          where: { id },
          data: { [key]: value },
        });
      } catch (error) {
        console.error(`Failed to update ${key} for CaseField ${id}`, error);
      }
    },
    [updateCaseField]
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

  const columns: CustomColumnDef<ExtendedCaseFields>[] = useMemo(
    () => getColumns(t, tCommon, session, handleToggle),
    [session, handleToggle, t, tCommon]
  );

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
      <Card>
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
              <AddCaseFieldModal />
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
      </Card>
    );
  }
  return null;
}
