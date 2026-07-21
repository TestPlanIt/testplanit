"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import {
  ColumnSelection,
  CustomColumnDef,
} from "@/components/tables/ColumnSelection";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CirclePlus } from "lucide-react";
import AddMilestonesToProjectsWizard from "./AddMilestonesToProjectsWizard";
import { AddMilestoneType } from "./AddMilestoneTypes";
import { ExtendedMilestoneTypes, useColumns } from "./columns";
import { DeleteMilestoneType } from "./DeleteMilestoneTypes";
import { EditMilestoneType } from "./EditMilestoneTypes";

export default function MilestoneTypesListPage() {
  return <MilestoneTypes />;
}

function MilestoneTypes() {
  const t = useTranslations("admin.milestones");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "name",
    direction: "asc",
  });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [addMilestoneTypeOpen, setAddMilestoneTypeOpen] = useState(false);
  const [editingMilestoneType, setEditingMilestoneType] =
    useState<ExtendedMilestoneTypes | null>(null);
  const [deletingMilestoneType, setDeletingMilestoneType] =
    useState<ExtendedMilestoneTypes | null>(null);

  const { data, isLoading } = useClientQueries(
    schema
  ).milestoneTypes.useFindMany(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
          },
          {
            isDeleted: false,
          },
        ],
      },
      include: {
        projects: {
          where: {
            project: {
              isDeleted: false,
            },
          },
        },
        icon: true,
      },
    },
    {
      enabled:
        (!!session?.user && debouncedSearchString.length === 0) ||
        debouncedSearchString.length > 0,
      refetchOnWindowFocus: true,
    }
  );

  const milestoneTypes = (data ?? []) as ExtendedMilestoneTypes[];

  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
  });

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [selectedMilestoneTypeId, setSelectedMilestoneTypeId] = useState<
    number | undefined
  >(undefined);

  const { mutateAsync: updateMilestoneType } =
    useClientQueries(schema).milestoneTypes.useUpdate();
  const { mutateAsync: createManyMilestoneTypeProjectAssignment } =
    useClientQueries(schema).milestoneTypesAssignment.useCreateMany();
  const { mutateAsync: deleteManyMilestoneTypesAssignment } =
    useClientQueries(schema).milestoneTypesAssignment.useDeleteMany();

  const handleToggleDefault = useCallback((id: number, _isDefault: boolean) => {
    setSelectedMilestoneTypeId(id);
    setIsAlertDialogOpen(true);
  }, []);

  const handleConfirmToggleDefault = async () => {
    setIsAlertDialogOpen(false);
    try {
      if (selectedMilestoneTypeId !== undefined) {
        // Setting isDefault=true clears the previous default atomically via the
        // tpl_single_default_milestonetypes DB trigger — no app-side clear needed.
        await updateMilestoneType({
          where: { id: selectedMilestoneTypeId },
          data: { isDefault: true },
        });

        await deleteManyMilestoneTypesAssignment({
          where: { milestoneTypeId: selectedMilestoneTypeId },
        });

        if (Array.isArray(projects)) {
          await createManyMilestoneTypeProjectAssignment({
            data: projects.map((project) => ({
              projectId: project.id,
              milestoneTypeId: selectedMilestoneTypeId,
            })),
          });
        }
      }
    } catch (error) {
      console.error("Failed to update milestone type:", error);
    }
  };

  const columns: CustomColumnDef<ExtendedMilestoneTypes>[] = useColumns(
    handleToggleDefault,
    tCommon,
    setEditingMilestoneType,
    setDeletingMilestoneType
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

  if (status === "loading") return null;

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle data-testid="milestones-page-title">
                {tGlobal("common.fields.milestoneTypes")}
              </CardTitle>
              <HelpPopover helpKey="milestoneTypes" />
            </SectionHeader>
            <div className="flex gap-2">
              <AddMilestonesToProjectsWizard />
              <Button
                onClick={() => setAddMilestoneTypeOpen(true)}
                aria-label={t("add.button")}
                className="group gap-0 transition-all duration-200 hover:gap-2"
              >
                <CirclePlus className="h-4 w-4" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                  {t("add.button")}
                </span>
              </Button>
            </div>
          </div>
          {addMilestoneTypeOpen && (
            <AddMilestoneType
              open={addMilestoneTypeOpen}
              onClose={() => setAddMilestoneTypeOpen(false)}
            />
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="milestone-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
              </div>
            </div>

            {milestoneTypes.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: milestoneTypes.length.toLocaleString(),
                  total: milestoneTypes.length.toLocaleString(),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 flex justify-between">
            <ColumnSelection
              key="milestone-column-selection"
              storageKey="admin-milestones"
              columns={columns}
              onVisibilityChange={setColumnVisibility}
            />
          </div>
          <div className="mt-4 w-full">
            <VirtualizedDataTable
              fillViewport
              columns={columns as any}
              data={milestoneTypes}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading}
              resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="admin-milestones-table"
              rowTestIdPrefix="admin-milestone-row"
            />
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={isAlertDialogOpen} onOpenChange={setIsAlertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDefault")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDefaultDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {t("warning")}
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setSelectedMilestoneTypeId(undefined)}
            >
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmToggleDefault}>
              {tCommon("actions.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {editingMilestoneType && (
        <EditMilestoneType
          milestoneType={editingMilestoneType}
          open={true}
          onClose={() => setEditingMilestoneType(null)}
        />
      )}
      {deletingMilestoneType && (
        <DeleteMilestoneType
          milestoneType={deletingMilestoneType}
          open={true}
          onClose={() => setDeletingMilestoneType(null)}
        />
      )}
    </main>
  );
}
