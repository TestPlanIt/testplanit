"use client";

import { useDebounce } from "@/components/Debounce";
import {
  ColumnSelection,
  CustomColumnDef,
} from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { useQueryClient } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { CirclePlus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { useRouter } from "~/lib/navigation";
import { ItemTypes } from "~/types/dndTypes";
import { performOptimisticReorder } from "~/utils/optimistic-updates";
import { schema } from "~/zenstack/schema";
import { DeleteFailureClassification } from "./DeleteFailureClassification";
import { FailureClassificationDialog } from "./FailureClassificationDialog";
import { useColumns } from "./columns";
import type { ClassificationRow } from "./types";

/**
 * The root cause catalogue in the order pickers and the AI's prompt list it.
 * Rows are dragged into order; a new entry lands at the end.
 */
export default function RootCausesPage() {
  const locale = useLocale();
  const t = useTranslations("admin.rootCauses");
  const tMenu = useTranslations("admin.menu");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [searchString, setSearchString] = useState("");
  const debouncedSearch = useDebounce(searchString, 500);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClassificationRow | null>(null);
  const [deleting, setDeleting] = useState<ClassificationRow | null>(null);

  useEffect(() => {
    if (status !== "loading" && !session) router.push("/");
  }, [status, session, router]);

  const queries = useClientQueries(schema);
  const { data, isLoading } = queries.failureClassification.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      include: {
        color: { select: { id: true, value: true } },
        _count: { select: { signatures: true } },
      },
    },
    { enabled: !!session?.user }
  );
  const { mutateAsync: update } = queries.failureClassification.useUpdate();

  // Local copy so a drag reorders instantly; the query refills it.
  const [rows, setRows] = useState<ClassificationRow[]>([]);
  useEffect(() => {
    setRows((data ?? []) as ClassificationRow[]);
  }, [data]);
  const search = debouncedSearch.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      search
        ? rows.filter((row) => row.name.toLowerCase().includes(search))
        : rows,
    [rows, search]
  );
  const nextOrder = rows.reduce((max, row) => Math.max(max, row.order), 0) + 1;

  const handleReorder = async (dragIndex: number, hoverIndex: number) => {
    const dragged = rows[dragIndex];
    if (!dragged) return;
    const reordered = [...rows];
    reordered.splice(dragIndex, 1);
    reordered.splice(hoverIndex, 0, dragged);
    setRows(reordered);
    try {
      await performOptimisticReorder({
        queryClient,
        queryKey: ["FailureClassification"],
        reorderFn: async () => {
          await Promise.all(
            reordered.map((row, index) =>
              row.order === index + 1
                ? Promise.resolve()
                : update({ where: { id: row.id }, data: { order: index + 1 } })
            )
          );
        },
        items: reordered,
        successMessage: t("reordered"),
        errorMessage: tCommon("errors.unknown"),
      });
    } catch (error) {
      console.error("Failed to reorder root causes", error);
    }
  };

  const onEdit = useCallback((row: ClassificationRow) => setEditing(row), []);
  const onDelete = useCallback(
    (row: ClassificationRow) => setDeleting(row),
    []
  );
  const columns: CustomColumnDef<ClassificationRow>[] = useColumns(
    tCommon,
    t,
    onEdit,
    onDelete
  );
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const hideColumnRef = useRef<((columnId: string) => void) | null>(null);

  if (status === "loading") return null;

  return (
    <main>
      <DndProvider backend={HTML5Backend}>
        <Card>
          <CardHeader className="w-full">
            <div className="flex items-center justify-between gap-2">
              <SectionHeader className="flex items-center gap-2">
                <CardTitle data-testid="root-causes-page-title">
                  {tMenu("rootCauses")}
                </CardTitle>
                <HelpPopover helpKey="rootCauses" />
              </SectionHeader>
              <Button
                onClick={() => setAdding(true)}
                aria-label={t("add.button")}
                className="group gap-0 transition-all duration-200 hover:gap-2"
                data-testid="failure-classification-add"
              >
                <CirclePlus className="h-4 w-4" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                  {t("add.button")}
                </span>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-row items-start justify-between gap-4">
              <div className="flex w-full min-w-[250px] grow flex-col sm:w-1/2">
                <div className="w-full text-nowrap text-muted-foreground">
                  <Filter
                    key="root-cause-filter"
                    placeholder={t("filterPlaceholder")}
                    initialSearchString={searchString}
                    onSearchChange={setSearchString}
                  />
                </div>
              </div>
              {rows.length > 0 && (
                <p className="shrink-0 text-sm text-muted-foreground">
                  {tGlobal("admin.auditLogs.showing", {
                    loaded: visibleRows.length.toLocaleString(locale),
                    total: rows.length.toLocaleString(locale),
                  })}
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-between">
              <ColumnSelection
                key="root-cause-column-selection"
                storageKey="admin-root-causes"
                columns={columns}
                onVisibilityChange={setColumnVisibility}
                hideColumnRef={hideColumnRef}
              />
            </div>
            <div className="mt-4 w-full" data-testid="admin-root-causes-table">
              <DataTable
                columns={columns as any}
                data={visibleRows}
                // Dragging only means something on the whole, unfiltered list.
                enableReorder={!search}
                onReorder={(dragIndex: number, hoverIndex: number) =>
                  void handleReorder(dragIndex, hoverIndex)
                }
                itemType={ItemTypes.ROOT_CAUSE}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                onHideColumn={(columnId) => hideColumnRef.current?.(columnId)}
                isLoading={isLoading}
                pageSize={5}
                storageKey="admin-root-causes"
                enableColumnReorder={false}
              />
            </div>
          </CardContent>
        </Card>
      </DndProvider>
      {adding && (
        <FailureClassificationDialog
          open={adding}
          nextOrder={nextOrder}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <FailureClassificationDialog
          open={true}
          classification={editing}
          nextOrder={nextOrder}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteFailureClassification
          classification={deleting}
          open={true}
          onClose={() => setDeleting(null)}
        />
      )}
    </main>
  );
}
