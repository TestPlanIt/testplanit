"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApplicationArea } from "@prisma/client";
import { Layers, Edit, Trash2, Save, CircleSlash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Filter } from "@/components/tables/Filter";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import {
  useFindManySharedStepGroup,
  useUpdateSharedStepGroup,
} from "~/lib/hooks/shared-step-group";
import {
  useFindManySharedStepItem,
  useUpdateSharedStepItem,
  useCreateSharedStepItem,
  useDeleteSharedStepItem,
} from "~/lib/hooks/shared-step-item";
import { StepsDisplay } from "~/app/[locale]/projects/repository/[projectId]/[caseId]/StepsDisplay";
import StepsForm from "~/app/[locale]/projects/repository/[projectId]/StepsForm";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useForm, FormProvider } from "react-hook-form";
import { toast } from "sonner";
import type { StepFormField } from "~/app/[locale]/projects/repository/[projectId]/StepsForm";
import LoadingSpinner from "~/components/LoadingSpinner";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useFindManyRepositoryCases } from "~/lib/hooks";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { ImportSharedStepsWizard } from "./ImportSharedStepsWizard";
import { ManualSharedStepsDialog } from "./ManualSharedStepsDialog";

// Component to show the number of test cases using a shared step group
function TestCaseCount({ groupId, t }: { groupId: number; t: any }) {
  const { data: steps, isLoading } = useFindManyRepositoryCases({
    where: {
      steps: {
        some: {
          sharedStepGroupId: groupId,
          isDeleted: false,
        },
      },
      isDeleted: false,
    },
    select: { id: true, name: true, source: true },
    orderBy: { createdAt: "desc" },
  });
  const count = steps?.length ?? 0;
  const label = isLoading ? (
    <LoadingSpinner className="inline-block align-middle w-3 h-3" />
  ) : (
    t("testCasesUsing", { count })
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span className="ml-1 cursor-pointer underline underline-offset-2">
          {label}
        </span>
      </PopoverTrigger>
      <PopoverContent className="flex items-center flex-wrap overflow-auto max-h-[calc(100vh-400px)] lg:w-[400px]">
        <div>
          {steps && steps.length > 0 ? (
            steps.map((testcase: any) => (
              <Badge key={testcase.id} className="mb-1 mr-1">
                <CaseDisplay
                  id={testcase.id}
                  name={testcase.name}
                  link={`/case/${testcase.id}`}
                  source={testcase.source}
                />
              </Badge>
            ))
          ) : isLoading ? (
            <LoadingSpinner className="inline-block align-middle w-4 h-4" />
          ) : (
            <span className="text-xs text-muted-foreground">
              {t("noTestCases")}
            </span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function SharedStepsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const t = useTranslations("sharedSteps");
  const tCommon = useTranslations("common");
  const [search, setSearch] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editGroupName, setEditGroupName] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const createStepMutation = useCreateSharedStepItem();
  const updateStepMutation = useUpdateSharedStepItem();
  const deleteStepMutation = useDeleteSharedStepItem();
  const [saving, setSaving] = useState(false);

  // Get groupId from URL if present
  const urlGroupId = searchParams.get("groupId");

  // Permissions
  const { permissions: perms, isLoading: permsLoading } = useProjectPermissions(
    projectId,
    ApplicationArea.SharedSteps
  );
  const canEdit = perms?.canAddEdit;
  const canDelete = perms?.canDelete;

  // Fetch groups
  const { data: groups = [], isLoading: groupsLoading } =
    useFindManySharedStepGroup({
      where: { projectId: Number(projectId), isDeleted: false },
      orderBy: { name: "asc" },
      include: { items: true },
    });

  // Filtered groups
  const filteredGroups = useMemo(() => {
    if (!search) return groups;
    return groups.filter((g: any) =>
      g.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [groups, search]);

  // Selected group
  const selectedGroup =
    groups.find((g: any) => g.id === selectedGroupId) || null;

  // Fetch items for selected group
  const { data: items = [], isLoading: itemsLoading } =
    useFindManySharedStepItem(
      selectedGroupId
        ? {
            where: { sharedStepGroupId: selectedGroupId },
            orderBy: { order: "asc" },
          }
        : { where: { sharedStepGroupId: -1 }, orderBy: { order: "asc" } },
      { enabled: !!selectedGroupId }
    );

  // Update group name
  const updateGroupMutation = useUpdateSharedStepGroup();
  const handleGroupNameSave = async () => {
    if (!selectedGroup || !editGroupName.trim()) return;
    await updateGroupMutation.mutateAsync({
      where: { id: selectedGroup.id },
      data: { name: editGroupName },
    });
    setEditMode(false);
  };

  // Soft-delete group
  const handleDeleteGroup = async () => {
    if (!selectedGroup) return;
    await updateGroupMutation.mutateAsync({
      where: { id: selectedGroup.id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    setShowDeleteDialog(false);
    setSelectedGroupId(null);
  };

  // Setup react-hook-form for editing steps
  const form = useForm<{ steps: StepFormField[] }>({
    defaultValues: {
      steps: items.map((item) => ({
        id: item.id?.toString(),
        step: item.step,
        expectedResult: item.expectedResult,
        sharedStepGroupId: null,
        originalId: item.id,
      })),
    },
    mode: "onChange",
  });

  // Save handler for steps and group name
  const handleSaveSteps = async () => {
    if (!selectedGroup) return;
    setSaving(true);
    try {
      const editedSteps: StepFormField[] = form.getValues("steps");
      // Find deleted steps (in items but not in editedSteps by id)
      const deleted = items.filter(
        (item) => !editedSteps.some((s: any) => s.originalId === item.id)
      );
      // Update or create steps
      for (let i = 0; i < editedSteps.length; i++) {
        const step = editedSteps[i];
        const stepData = {
          step: step.step
            ? typeof step.step === "string"
              ? step.step
              : JSON.stringify(step.step)
            : JSON.stringify(""),
          expectedResult: step.expectedResult
            ? typeof step.expectedResult === "string"
              ? step.expectedResult
              : JSON.stringify(step.expectedResult)
            : JSON.stringify(""),
          order: i,
        };
        if (step.originalId) {
          try {
            await updateStepMutation.mutateAsync({
              where: { id: step.originalId },
              data: stepData,
            });
          } catch (err) {
            console.error("[SharedSteps] updateStepMutation error", err, {
              where: { id: step.originalId },
              data: stepData,
            });
            throw err;
          }
        } else {
          const createPayload = {
            ...stepData,
            sharedStepGroupId: selectedGroup.id,
          };
          try {
            await createStepMutation.mutateAsync({
              data: createPayload,
            });
          } catch (err) {
            console.error("[SharedSteps] createStepMutation error", err, {
              data: createPayload,
            });
            throw err;
          }
        }
      }
      // Delete removed steps
      for (const del of deleted) {
        try {
          await deleteStepMutation.mutateAsync({ where: { id: del.id } });
        } catch (err) {
          console.error("[SharedSteps] deleteStepMutation error", err, {
            id: del.id,
          });
          throw err;
        }
      }
      // Update group name if changed
      if (editGroupName.trim() && editGroupName !== selectedGroup.name) {
        await updateGroupMutation.mutateAsync({
          where: { id: selectedGroup.id },
          data: { name: editGroupName },
        });
      }
      toast.success(t("saveSuccess"));
      setEditMode(false);
      // Optionally, refetch items/groups here if needed
    } catch (e) {
      console.error("[SharedSteps] handleSaveSteps error", e);
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  // Reset form values to current items when entering edit mode or items change
  useEffect(() => {
    if (editMode && items) {
      form.reset({
        steps: items.map((item) => ({
          id: item.id?.toString(),
          step: item.step,
          expectedResult: item.expectedResult,
          sharedStepGroupId: null,
          originalId: item.id,
        })),
      });
    }
  }, [editMode, items, form]);

  // Set selected group from URL parameter when component mounts or groups load
  useEffect(() => {
    if (urlGroupId && groups.length > 0 && !selectedGroupId) {
      const groupId = parseInt(urlGroupId);
      const group = groups.find((g: any) => g.id === groupId);
      if (group) {
        setSelectedGroupId(groupId);
        setEditGroupName(group.name);

        // Scroll the selected group into view
        setTimeout(() => {
          const element = document.getElementById(
            `shared-step-group-${groupId}`
          );
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 100);
      }
    }
  }, [urlGroupId, groups, selectedGroupId]);

  return (
    <div className="flex h-full w-full" data-testid="shared-steps-page">
      {/* Left Pane: Group List & Filter */}
      <div className="w-1/3 min-w-[280px] max-w-[600px] border-r bg-primary-foreground p-4 flex flex-col">
        {canEdit && (
          <div className="mb-4 flex gap-2 justify-between w-fill">
            <ManualSharedStepsDialog
              onComplete={() => {
                // Refetch groups when manual entry completes
                window.location.reload();
              }}
            />
            <ImportSharedStepsWizard
              onImportComplete={() => {
                // Refetch groups when import completes
                window.location.reload();
              }}
            />
          </div>
        )}
        <div className="mb-4">
          <Filter
            placeholder={t("filterPlaceholder")}
            onSearchChange={setSearch}
            dataTestId="shared-steps-filter"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {groupsLoading ? (
            <div>
              <LoadingSpinner />
            </div>
          ) : filteredGroups.length === 0 ? (
            <div>{t("noGroups")}</div>
          ) : (
            <ul className="space-y-2">
              {filteredGroups.map((group: any) => (
                <li
                  key={group.id}
                  id={`shared-step-group-${group.id}`}
                  className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors min-h-10 h-10 ${selectedGroupId === group.id ? "bg-primary/10" : "hover:bg-muted"}`}
                  style={{ boxSizing: "border-box" }}
                  onClick={() => {
                    setSelectedGroupId(group.id);
                    setEditMode(false);
                    setEditGroupName(group.name);
                  }}
                  data-testid={`shared-step-group-${group.id}`}
                >
                  <Layers className="w-5 h-5 text-primary" />
                  <span className="flex-1 truncate" data-testid="group-name">
                    {group.name}
                  </span>
                  <span
                    className="text-xs text-muted-foreground ml-2"
                    data-testid="group-steps-count"
                  >
                    {t("stepsCount", { count: group.items?.length || 0 })} |
                    <TestCaseCount groupId={group.id} t={t} />
                  </span>
                  {canDelete && selectedGroupId === group.id && !editMode && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteDialog(true);
                      }}
                      data-testid="delete-group-btn"
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {/* Right Pane: Steps Display/Edit */}
      <div className="flex-1 p-6 overflow-y-auto">
        {!selectedGroup ? (
          <div className="text-muted-foreground text-center mt-20">
            {t("selectGroupPrompt")}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Layers className="w-6 h-6 text-primary" />
                {editMode ? (
                  <>
                    <Input
                      className="border rounded px-2 py-1 text-lg flex-1"
                      value={editGroupName}
                      onChange={(e) => setEditGroupName(e.target.value)}
                      data-testid="edit-group-name-input-main"
                      readOnly={false}
                    />
                    {canEdit && (
                      <>
                        <Button
                          onClick={() => {
                            setEditMode(false);
                            setEditGroupName(selectedGroup?.name || "");
                          }}
                          disabled={saving}
                          variant="outline"
                          data-testid="cancel-edit-group-btn"
                          className="ml-2"
                        >
                          <CircleSlash2 className="w-4 h-4" />
                          {tCommon("cancel")}
                        </Button>
                        <Button
                          onClick={handleSaveSteps}
                          disabled={saving}
                          variant="default"
                          data-testid="save-group-btn"
                          className="ml-2"
                        >
                          <Save className="w-4 h-4" />
                          {saving ? tCommon("actions.saving") : t("save")}
                        </Button>
                      </>
                    )}
                    {canDelete && (
                      <Button
                        onClick={() => setShowDeleteDialog(true)}
                        disabled={saving}
                        variant="destructive"
                        data-testid="delete-group-btn-main"
                        className="ml-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        {tCommon("actions.delete")}
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <span
                      className="font-bold text-lg flex-1"
                      data-testid="selected-group-name"
                    >
                      {selectedGroup.name}
                    </span>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditMode(true)}
                        data-testid="edit-group-name-btn-main"
                        className="ml-2"
                      >
                        <Edit className="w-4 h-4" />
                        {tCommon("actions.edit")}
                      </Button>
                    )}
                  </>
                )}
              </div>
              {/* Steps display or edit */}
              {canEdit && editMode ? (
                <FormProvider {...form}>
                  <StepsForm
                    control={form.control}
                    name="steps"
                    steps={form.getValues("steps")}
                    readOnly={false}
                    projectId={Number(projectId)}
                    onSharedStepCreated={undefined}
                    hideSharedStepsButtons={true}
                  />
                </FormProvider>
              ) : (
                <>
                  {items && items.length > 0 ? (
                    <StepsDisplay
                      steps={items.map(({ sharedStepGroupId, ...rest }) => ({
                        ...rest,
                        sharedStepGroupId: null,
                      }))}
                    />
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              {t("deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteGroup}
              data-testid="confirm-delete-group-btn"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
