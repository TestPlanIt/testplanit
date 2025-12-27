"use client";

import React, { useState, useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useFindManyTestRunCases, useFindUniqueTestRuns } from "~/lib/hooks";
import LoadingSpinner from "~/components/LoadingSpinner";
import LoadingSpinnerAlert from "~/components/LoadingSpinnerAlert";
import { HelpPopover } from "@/components/ui/help-popover";

interface DuplicateTestRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testRunId: number;
  testRunName: string;
  onPrepareCloneDataAndProceed: (props: AddTestRunModalInitProps) => void;
}

const FormSchema = z.object({
  statusesToInclude: z.array(z.number()),
  copyAssignments: z.boolean(),
});

type FormValues = z.infer<typeof FormSchema>;

export interface AddRunModalDuplicationPreset {
  originalRunId: number;
  copyAssignments: "copy" | "unassign";
  originalName: string;
  originalConfigId: number | null;
  originalMilestoneId: number | null;
  originalStateId: number | null;
  originalNote?: any;
  originalDocs?: any;
}

export interface AddTestRunModalInitProps {
  initialSelectedCaseIds: number[];
  duplicationPreset: AddRunModalDuplicationPreset;
  defaultMilestoneId?: number;
}

const DuplicateTestRunDialog: React.FC<DuplicateTestRunDialogProps> = ({
  open,
  onOpenChange,
  testRunId,
  testRunName,
  onPrepareCloneDataAndProceed,
}) => {
  const t = useTranslations("runs.duplicateDialog");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const [isSubmittingThisDialog, setIsSubmittingThisDialog] = useState(false);
  const [initialStatusesSet, setInitialStatusesSet] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      statusesToInclude: [],
      copyAssignments: false,
    },
  });

  const { setValue, getValues, handleSubmit, watch } = form;

  const { data: originalRunData, isLoading: isLoadingOriginalRun } =
    useFindUniqueTestRuns(
      {
        where: { id: testRunId },
        select: {
          name: true,
          configId: true,
          milestoneId: true,
          stateId: true,
          note: true,
          docs: true,
          testCases: {
            where: {
              repositoryCase: {
                isDeleted: false,
              },
            },
            select: {
              repositoryCaseId: true,
              statusId: true,
              repositoryCase: {
                select: {
                  isDeleted: true,
                },
              },
              results: {
                select: { statusId: true },
                orderBy: { executedAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
      { enabled: open }
    );

  const {
    data: testRunCasesDataForStatusList,
    isLoading: isLoadingCasesForStatusList,
  } = useFindManyTestRunCases(
    {
      where: {
        testRunId: testRunId,
        repositoryCase: {
          isDeleted: false,
        },
      },
      include: {
        repositoryCase: { select: { id: true } },
        status: {
          select: {
            id: true,
            name: true,
            order: true,
            color: { select: { value: true } },
          },
        },
        results: {
          select: {
            status: {
              select: {
                id: true,
                name: true,
                order: true,
                color: { select: { value: true } },
              },
            },
          },
          orderBy: { executedAt: "desc" },
          take: 1,
        },
      },
    },
    { enabled: Boolean(open) }
  );

  const UNTESTED_STATUS_ID = 0;
  const DEFAULT_UNTESTED_COLOR = "#9ca3af";

  const availableStatuses = React.useMemo(() => {
    if (!testRunCasesDataForStatusList) return [];
    const statusesMap = new Map<
      number,
      {
        id: number;
        name: string;
        order: number | null;
        colorValue: string | null;
        count: number;
      }
    >();
    let untestedCaseCount = 0;

    testRunCasesDataForStatusList.forEach((testCase) => {
      let effectiveStatus: {
        id: number;
        name: string;
        order: number | null;
        colorValue: string | null;
      } | null = null;

      if (testCase.results && testCase.results.length > 0) {
        const latestResult = testCase.results[0];
        if (latestResult.status) {
          effectiveStatus = {
            ...latestResult.status,
            order:
              typeof latestResult.status.order === "number"
                ? latestResult.status.order
                : Infinity,
            colorValue: latestResult.status.color?.value ?? null,
          };
        }
      } else if (testCase.status) {
        effectiveStatus = {
          ...testCase.status,
          order:
            typeof testCase.status.order === "number"
              ? testCase.status.order
              : Infinity,
          colorValue: testCase.status.color?.value ?? null,
        };
      }

      if (effectiveStatus) {
        if (statusesMap.has(effectiveStatus.id)) {
          statusesMap.get(effectiveStatus.id)!.count++;
        } else {
          statusesMap.set(effectiveStatus.id, { ...effectiveStatus, count: 1 });
        }
      } else {
        untestedCaseCount++;
      }
    });

    const distinctStatuses = Array.from(statusesMap.values());

    if (untestedCaseCount > 0) {
      const existingUntestedFromMap = statusesMap.get(UNTESTED_STATUS_ID);
      if (existingUntestedFromMap) {
        existingUntestedFromMap.count += untestedCaseCount;
      } else {
        let alreadyPresentAsRealStatus = false;
        for (const s of distinctStatuses) {
          if (s.id === UNTESTED_STATUS_ID) {
            alreadyPresentAsRealStatus = true;
            s.count += untestedCaseCount;
            break;
          }
        }
        if (!alreadyPresentAsRealStatus) {
          distinctStatuses.push({
            id: UNTESTED_STATUS_ID,
            name: tGlobal("common.labels.untested"),
            order: -1,
            colorValue: DEFAULT_UNTESTED_COLOR,
            count: untestedCaseCount,
          });
        }
      }
    }

    return distinctStatuses.sort((a, b) => {
      const orderA = a.order ?? Infinity;
      const orderB = b.order ?? Infinity;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.name.localeCompare(b.name);
    });
  }, [
    testRunCasesDataForStatusList,
    tGlobal,
    UNTESTED_STATUS_ID,
    DEFAULT_UNTESTED_COLOR,
  ]);

  useEffect(() => {
    if (open && !isLoadingCasesForStatusList && !initialStatusesSet) {
      if (availableStatuses.length > 0) {
        setValue(
          "statusesToInclude",
          availableStatuses.map((status) => status.id)
        );
      } else {
        setValue("statusesToInclude", []);
      }
      setInitialStatusesSet(true);
    }
    if (!open && initialStatusesSet) {
      setInitialStatusesSet(false);
    }
  }, [
    open,
    isLoadingCasesForStatusList,
    availableStatuses,
    setValue,
    initialStatusesSet,
  ]);

  const handleDuplicateOptionsSubmit = (data: FormValues) => {
    if (!originalRunData || !originalRunData.testCases) {
      toast.error(tCommon("errors.somethingWentWrong") + " (TRD001)");
      return;
    }
    setIsSubmittingThisDialog(true);

    try {
      const repositoryCaseIdsToDuplicate: number[] = [];
      originalRunData.testCases.forEach((tc) => {
        if (tc.repositoryCase && !tc.repositoryCase.isDeleted) {
          let effectiveStatusId: number | null = null;
          if (tc.results && tc.results.length > 0 && tc.results[0].statusId) {
            effectiveStatusId = tc.results[0].statusId;
          } else if (tc.statusId) {
            effectiveStatusId = tc.statusId;
          }

          if (effectiveStatusId === null) {
            // Case is "Untested" effectively
            if (data.statusesToInclude.includes(UNTESTED_STATUS_ID)) {
              repositoryCaseIdsToDuplicate.push(tc.repositoryCaseId);
            }
          } else if (data.statusesToInclude.includes(effectiveStatusId)) {
            repositoryCaseIdsToDuplicate.push(tc.repositoryCaseId);
          }
        }
      });

      const propsForAddModal: AddTestRunModalInitProps = {
        initialSelectedCaseIds: repositoryCaseIdsToDuplicate,
        duplicationPreset: {
          originalRunId: testRunId,
          copyAssignments: data.copyAssignments ? "copy" : "unassign",
          originalName: originalRunData.name || testRunName,
          originalConfigId: originalRunData.configId,
          originalMilestoneId: originalRunData.milestoneId,
          originalStateId: originalRunData.stateId,
          originalNote: originalRunData.note,
          originalDocs: originalRunData.docs,
        },
        defaultMilestoneId: originalRunData.milestoneId ?? undefined,
      };

      onPrepareCloneDataAndProceed(propsForAddModal);
      onOpenChange(false); // This will trigger form.reset() via the Dialog's onOpenChange prop
    } catch (error) {
      console.error("Error in duplicate submission process:", error);
      toast.error(tCommon("errors.somethingWentWrong"));
    } finally {
      setIsSubmittingThisDialog(false);
    }
  };

  if (!open) return null;
  if (
    isLoadingOriginalRun ||
    (open && !testRunCasesDataForStatusList && isLoadingCasesForStatusList)
  ) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center items-center p-4">
            <LoadingSpinner />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          form.reset();
          setInitialStatusesSet(false);
        }
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t.rich("description", {
              name: testRunName || "",
              nameStyle: (chunks: React.ReactNode) => (
                <span className="font-semibold">{chunks}</span>
              ),
            })}
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form
            onSubmit={handleSubmit(handleDuplicateOptionsSubmit)}
            className="space-y-6"
          >
            <FormField
              control={form.control}
              name="statusesToInclude"
              render={() => (
                <FormItem>
                  <div className="mb-4">
                    <FormLabel className="text-base flex items-center">
                      {t("fields.statusesToInclude.label")}
                      <HelpPopover helpKey="testRun.duplicate.statusesToInclude" />
                    </FormLabel>
                    <FormDescription>
                      {t("fields.statusesToInclude.description")}
                    </FormDescription>
                  </div>
                  {isLoadingCasesForStatusList ? (
                    <LoadingSpinnerAlert />
                  ) : availableStatuses.length > 0 ? (
                    <div className="max-h-40 overflow-y-auto space-y-2 pr-2 border rounded-md p-2">
                      {availableStatuses.map((status) => (
                        <FormField
                          key={status.id}
                          control={form.control}
                          name="statusesToInclude"
                          render={({ field: statusField }) => {
                            return (
                              <FormItem
                                key={status.id}
                                className="flex flex-row items-center space-x-2 space-y-0"
                              >
                                <FormControl>
                                  <Checkbox
                                    checked={statusField.value?.includes(
                                      status.id
                                    )}
                                    onCheckedChange={(checked) => {
                                      return checked
                                        ? statusField.onChange([
                                            ...(statusField.value || []),
                                            status.id,
                                          ])
                                        : statusField.onChange(
                                            statusField.value?.filter(
                                              (value) => value !== status.id
                                            )
                                          );
                                    }}
                                    disabled={isSubmittingThisDialog}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal flex items-center">
                                  <Badge
                                    style={{
                                      backgroundColor:
                                        status.colorValue ||
                                        DEFAULT_UNTESTED_COLOR,
                                    }}
                                    className="text-primary-foreground"
                                  >
                                    {status.name}
                                  </Badge>
                                  <span className="ml-1.5 text-muted-foreground">
                                    {`(${status.count} ${tCommon("plural.case", { count: status.count })})`}
                                  </span>
                                </FormLabel>
                              </FormItem>
                            );
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("fields.statusesToInclude.noStatusesRecorded")}
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="copyAssignments"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base flex items-center">
                      {t("fields.copyAssignments.label")}
                      <HelpPopover helpKey="testRun.duplicate.copyAssignments" />
                    </FormLabel>
                    <FormDescription>
                      {field.value
                        ? t("fields.copyAssignments.assign")
                        : t("fields.copyAssignments.unassign")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      id="copy-assignments-switch"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isSubmittingThisDialog}
                      aria-label={t("fields.copyAssignments.label")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmittingThisDialog}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  isSubmittingThisDialog ||
                  isLoadingCasesForStatusList ||
                  isLoadingOriginalRun ||
                  (availableStatuses.length > 0 &&
                    (getValues("statusesToInclude") || []).length === 0)
                }
              >
                {isSubmittingThisDialog ? (
                  <div className="flex items-center justify-center gap-1">
                    <LoadingSpinner />
                    {tCommon("actions.next")}
                  </div>
                ) : (
                  tCommon("actions.next")
                )}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
};

export default DuplicateTestRunDialog;
