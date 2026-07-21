"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DataTable } from "@/components/tables/DataTable";
import { WorkflowScope } from "~/zenstack/models";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { scopeDisplayData } from "~/app/constants";
import { useRouter } from "~/lib/navigation";
import { performOptimisticReorder } from "~/utils/optimistic-updates";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { useColumns } from "./columns";

import { WorkflowDragPreview } from "@/components/dnd/WorkflowDragPreview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { CirclePlus } from "lucide-react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { ItemTypes } from "~/types/dndTypes";
import { ExtendedWorkflows } from "~/types/Workflows";
import { AddWorkflows } from "./AddWorkflow";
import { DeleteWorkflows } from "./DeleteWorkflow";
import { EditWorkflows } from "./EditWorkflow";
import { SystemFeatureCard } from "./SystemFeatureCard";

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

export default function WorkflowsList() {
  return <WorkflowComponent />;
}

function WorkflowComponent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.workflows");
  const tCommon = useTranslations("common");
  const tWorkflowTypes = useTranslations("enums.WorkflowType");
  const [pageSize] = useState(10);
  const queryClient = useQueryClient();

  const [casesWorkflows, setCasesWorkflows] = useState<ExtendedWorkflows[]>([]);
  const [runsWorkflows, setRunsWorkflows] = useState<ExtendedWorkflows[]>([]);
  const [sessionsWorkflows, setSessionsWorkflows] = useState<
    ExtendedWorkflows[]
  >([]);

  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [addWorkflowScope, setAddWorkflowScope] =
    useState<WorkflowScope | null>(null);
  const [editingWorkflow, setEditingWorkflow] =
    useState<ExtendedWorkflows | null>(null);
  const [deletingWorkflow, setDeletingWorkflow] =
    useState<ExtendedWorkflows | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<
    number | undefined
  >(undefined);
  const [selectedWorkflowScope, setSelectedWorkflowScope] = useState<
    WorkflowScope | undefined
  >(undefined);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const { mutateAsync: updateWorkflows } =
    useClientQueries(schema).workflows.useUpdate();
  const { mutateAsync: createManyProjectWorkflowAssignment } =
    useClientQueries(schema).projectWorkflowAssignment.useCreateMany();
  const { mutateAsync: deleteManyProjectWorkflowAssignment } =
    useClientQueries(schema).projectWorkflowAssignment.useDeleteMany();
  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
  });

  const { data, isLoading } = useClientQueries(schema).workflows.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: { order: "asc" },
      include: {
        icon: true,
        color: true,
        // Only the assignment COUNT here — the full per-workflow project list
        // (hundreds per workflow on large instances) is fetched lazily by the
        // Projects column's ProjectListDisplay when its popover opens. Eagerly
        // including every assignment made this query fetch tens of thousands of
        // nested rows and stalled the page.
        _count: { select: { projects: true } },
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  useEffect(() => {
    if (data) {
      setCasesWorkflows(
        data.filter((workflow) => workflow.scope === WorkflowScope.CASES)
      );
      setRunsWorkflows(
        data.filter((workflow) => workflow.scope === WorkflowScope.RUNS)
      );
      setSessionsWorkflows(
        data.filter((workflow) => workflow.scope === WorkflowScope.SESSIONS)
      );
    }
  }, [data]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const handleToggleEnabled = async (id: number, isEnabled: boolean) => {
    try {
      await updateWorkflows({
        where: { id },
        data: { isEnabled },
      });
    } catch (error) {
      console.error("Failed to update workflow:", error);
    }
  };

  const handleToggleRequiresReview = async (
    id: number,
    requiresReview: boolean
  ) => {
    try {
      await updateWorkflows({
        where: { id },
        data: { requiresReview },
      });
    } catch (error) {
      console.error("Failed to update workflow requiresReview:", error);
    }
  };

  const { systemEnabled: reviewFeatureSystemEnabled } =
    useReviewFeatureEnabled();
  const showRequiresReview = reviewFeatureSystemEnabled === true;

  const handleToggleDefault = (
    id: number,
    isDefault: boolean,
    scope: WorkflowScope
  ) => {
    setSelectedWorkflowId(id);
    setSelectedWorkflowScope(scope);
    setIsAlertDialogOpen(true);
  };

  const columns = useColumns(
    data || [],
    tWorkflowTypes,
    tCommon,
    t,
    handleToggleEnabled,
    handleToggleDefault,
    showRequiresReview,
    handleToggleRequiresReview,
    setEditingWorkflow,
    setDeletingWorkflow
  );

  if (status === "loading") return null;

  const handleConfirmToggleDefault = async () => {
    setIsAlertDialogOpen(false);
    try {
      if (
        selectedWorkflowId !== undefined &&
        selectedWorkflowScope !== undefined
      ) {
        // The single-default DB trigger (tpl_single_default_workflows) clears
        // the previous default for this scope atomically.
        await updateWorkflows({
          where: { id: selectedWorkflowId },
          data: { isDefault: true, isEnabled: true },
        });

        await deleteManyProjectWorkflowAssignment({
          where: { workflowId: selectedWorkflowId },
        });

        if (Array.isArray(projects)) {
          await createManyProjectWorkflowAssignment({
            data: projects.map((project) => ({
              projectId: project.id,
              workflowId: selectedWorkflowId,
            })),
          });
        }
      }
    } catch (error) {
      console.error("Failed to update workflow:", error);
    }
  };

  const renderWorkflowCard = (
    workflows: ExtendedWorkflows[],
    scope: WorkflowScope
  ) => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{scopeDisplayData[scope].text}</CardTitle>
          </SectionHeader>
          <Button
            onClick={() => setAddWorkflowScope(scope)}
            aria-label={t("add.button")}
            className="group gap-0 transition-all duration-200 hover:gap-2"
          >
            <CirclePlus className="h-4 w-4" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
              {t("add.button")}
            </span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* <ColumnSelection
          columns={columns}
          onVisibilityChange={setColumnVisibility}
        /> */}
        <div className="w-fit">
          <DataTable
            columns={columns}
            data={workflows}
            enableReorder
            onReorder={(dragIndex: number, hoverIndex: number) =>
              handleReorder(dragIndex, hoverIndex, workflows, scope)
            }
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            isLoading={isLoading}
            pageSize={pageSize}
            itemType={ItemTypes.WORKFLOW}
            storageKey="admin-workflows"
            enableColumnReorder={false}
            enableColumnMenu={false}
          />
        </div>
      </CardContent>
    </Card>
  );

  const handleReorder = async (
    dragIndex: number,
    hoverIndex: number,
    workflows: ExtendedWorkflows[],
    scope: WorkflowScope
  ) => {
    const draggedItem = workflows[dragIndex];
    if (!draggedItem) {
      return;
    }

    // Create a new array with the reordered items
    const reorderedWorkflows = [...workflows];
    reorderedWorkflows.splice(dragIndex, 1);
    reorderedWorkflows.splice(hoverIndex, 0, draggedItem);

    // Update the local state immediately for instant feedback
    switch (scope) {
      case WorkflowScope.CASES:
        setCasesWorkflows(reorderedWorkflows);
        break;
      case WorkflowScope.RUNS:
        setRunsWorkflows(reorderedWorkflows);
        break;
      case WorkflowScope.SESSIONS:
        setSessionsWorkflows(reorderedWorkflows);
        break;
    }

    try {
      await performOptimisticReorder({
        queryClient,
        queryKey: ["Workflows"],
        reorderFn: async () => {
          await Promise.all(
            reorderedWorkflows.map((workflow, index) =>
              updateWorkflows({
                where: { id: workflow.id },
                data: { order: index + 1 },
              })
            )
          );
        },
        items: reorderedWorkflows,
        successMessage: `${scope.toLowerCase()} workflows reordered successfully`,
        errorMessage: `Failed to reorder ${scope.toLowerCase()} workflows`,
      });
    } catch (error) {
      console.error(`Failed to reorder ${scope} workflows`, error);
      // Revert the local state on error
      // The data hook will re-render with the correct order
    }
  };

  return (
    <main>
      {session && session.user.access === "ADMIN" && (
        <DndProvider backend={HTML5Backend}>
          <WorkflowDragPreview />
          <Card>
            <CardHeader className="w-full">
              <SectionHeader className="flex items-center gap-2">
                <CardTitle>{t("reviewsTitle")}</CardTitle>
                <HelpPopover helpKey="workflowReviews" />
              </SectionHeader>
            </CardHeader>
            <CardContent>
              <SystemFeatureCard embedded />
            </CardContent>
          </Card>
          <div className="mt-4">
            {renderWorkflowCard(casesWorkflows, WorkflowScope.CASES)}
          </div>
          <div className="mt-4">
            {renderWorkflowCard(runsWorkflows, WorkflowScope.RUNS)}
          </div>
          <div className="mt-4">
            {renderWorkflowCard(sessionsWorkflows, WorkflowScope.SESSIONS)}
          </div>
          <AlertDialog
            open={isAlertDialogOpen}
            onOpenChange={setIsAlertDialogOpen}
          >
            <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center">
                  {t("setDefault.title")}
                </AlertDialogTitle>
              </AlertDialogHeader>
              {t("setDefault.confirmMessage")}
              <AlertDialogDescription>
                {t("setDefault.description")}
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setIsAlertDialogOpen(false)}>
                  {tCommon("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleConfirmToggleDefault()}
                  className="bg-destructive"
                >
                  {tCommon("actions.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {addWorkflowScope && (
            <AddWorkflows
              open
              onClose={() => setAddWorkflowScope(null)}
              defaultScope={addWorkflowScope}
            />
          )}
        </DndProvider>
      )}
      {editingWorkflow && (
        <EditWorkflows
          workflows={editingWorkflow}
          allWorkflows={data || []}
          open={true}
          onClose={() => setEditingWorkflow(null)}
        />
      )}
      {deletingWorkflow && (
        <DeleteWorkflows
          workflows={deletingWorkflow}
          open={true}
          onClose={() => setDeletingWorkflow(null)}
        />
      )}
    </main>
  );
}
