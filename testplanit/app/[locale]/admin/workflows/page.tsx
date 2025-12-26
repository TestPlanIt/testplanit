"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { performOptimisticReorder } from "~/utils/optimistic-updates";
import {
  useFindManyWorkflows,
  useUpdateWorkflows,
  useUpdateManyWorkflows,
  useCreateManyProjectWorkflowAssignment,
  useDeleteManyProjectWorkflowAssignment,
  useFindManyProjects,
} from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns } from "./columns";
import { scopeDisplayData } from "~/app/constants";
import { WorkflowScope } from "@prisma/client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { AddWorkflowsModal } from "./AddWorkflow";
import { ExtendedWorkflows } from "~/types/Workflows";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { WorkflowDragPreview } from "@/components/dnd/WorkflowDragPreview";
import { ItemTypes } from "~/types/dndTypes";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

export default function WorkflowsList() {
  return <WorkflowComponent />;
}

function WorkflowComponent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.workflows");
  const tCommon = useTranslations("common");
  const [pageSize, setPageSize] = useState(10);
  const queryClient = useQueryClient();

  const [casesWorkflows, setCasesWorkflows] = useState<ExtendedWorkflows[]>([]);
  const [runsWorkflows, setRunsWorkflows] = useState<ExtendedWorkflows[]>([]);
  const [sessionsWorkflows, setSessionsWorkflows] = useState<
    ExtendedWorkflows[]
  >([]);

  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<
    number | undefined
  >(undefined);
  const [selectedWorkflowScope, setSelectedWorkflowScope] = useState<
    WorkflowScope | undefined
  >(undefined);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const { mutateAsync: updateWorkflows } = useUpdateWorkflows();
  const { mutateAsync: updateManyWorkflows } = useUpdateManyWorkflows();
  const { mutateAsync: createManyProjectWorkflowAssignment } =
    useCreateManyProjectWorkflowAssignment();
  const { mutateAsync: deleteManyProjectWorkflowAssignment } =
    useDeleteManyProjectWorkflowAssignment();
  const { data: projects } = useFindManyProjects({
    where: { isDeleted: false },
  });

  const { data, isLoading } = useFindManyWorkflows(
    {
      where: { isDeleted: false },
      orderBy: { order: "asc" },
      include: {
        icon: true,
        color: true,
        projects: {
          select: {
            projectId: true,
            project: {
              select: {
                name: true,
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

  if (status === "loading") return null;

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

  const handleToggleDefault = (
    id: number,
    isDefault: boolean,
    scope: WorkflowScope
  ) => {
    setSelectedWorkflowId(id);
    setSelectedWorkflowScope(scope);
    setIsAlertDialogOpen(true);
  };

  const handleConfirmToggleDefault = async () => {
    setIsAlertDialogOpen(false);
    try {
      if (
        selectedWorkflowId !== undefined &&
        selectedWorkflowScope !== undefined
      ) {
        await updateManyWorkflows({
          where: { isDefault: true, scope: selectedWorkflowScope },
          data: { isDefault: false },
        });
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

  const columns = getColumns(
    data || [],
    t,
    tCommon,
    handleToggleEnabled,
    handleToggleDefault
  );

  const renderWorkflowCard = (
    workflows: ExtendedWorkflows[],
    scope: WorkflowScope
  ) => (
    <Card>
      <CardHeader>
        <CardTitle>
          <div className="flex items-center text-primary text-xl md:text-2xl">
            {scope === "CASES" && (
              <>
                <scopeDisplayData.CASES.icon className="mr-2" />
                {scopeDisplayData.CASES.text}
              </>
            )}
            {scope === "RUNS" && (
              <>
                <scopeDisplayData.RUNS.icon className="mr-2" />
                {scopeDisplayData.RUNS.text}
              </>
            )}
            {scope === "SESSIONS" && (
              <>
                <scopeDisplayData.SESSIONS.icon className="mr-2" />
                {scopeDisplayData.SESSIONS.text}
              </>
            )}
          </div>
        </CardTitle>
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
              <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
                <div>
                  <CardTitle>{tCommon("labels.workflows")}</CardTitle>
                </div>
                <div>
                  <AddWorkflowsModal />
                </div>
              </div>
              <CardDescription>{t("description")}</CardDescription>
            </CardHeader>
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
        </DndProvider>
      )}
    </main>
  );
}
