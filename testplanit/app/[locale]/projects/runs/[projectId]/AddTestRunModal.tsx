/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { AttachmentsDisplay } from "@/components/AttachmentsDisplay";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import {
  MilestoneSelect,
  transformMilestones,
} from "@/components/forms/MilestoneSelect";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { ManageTags } from "@/components/ManageTags";
import { MagicSelectButton } from "@/components/runs/MagicSelectButton";
import { SelectedTestCasesDrawer } from "@/components/SelectedTestCasesDrawer";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import UploadAttachments, {
  type LinkAttachmentInput,
} from "@/components/UploadAttachments";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { ApplicationArea, TestRunType } from "~/zenstack/models";
import type { Attachments } from "~/zenstack/models";
import { DialogDescription } from "@radix-ui/react-dialog";
import { Combine } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAssignmentsForRunCases,
  type GetAssignmentsResponse,
} from "~/app/actions/getAssignmentsForRunCases";
import { emptyEditorContent } from "~/app/constants";
import { planDuplicationGroup } from "./duplicationGroup";
import { iterationProgressBus } from "~/lib/services/iterationProgressBus";
import LoadingSpinner from "~/components/LoadingSpinner";
import LoadingSpinnerAlert from "~/components/LoadingSpinnerAlert";
import { RunPreflightChip } from "@/components/runs/RunPreflightChip";
import { RunCardinalityHardRefuseDialog } from "@/components/runs/RunCardinalityHardRefuseDialog";
import { RunCardinalitySoftConfirmDialog } from "@/components/runs/RunCardinalitySoftConfirmDialog";
import type { PreflightResult } from "~/lib/types/iterationCardinality";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRouter } from "~/lib/navigation";
import { updateTestRunForecast } from "~/services/testRunService";
import { IconName } from "~/types/globals";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import ProjectRepository from "../../repository/[projectId]/ProjectRepository";

interface WorkflowOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
  requiresReview?: boolean;
  disabledForCreate?: boolean;
}

interface ConfigurationOption {
  id: number;
  name: string;
}

// Define the form schemas via factory so messages reflect the active locale.
function buildBasicInfoFormSchema(t: (key: any) => string) {
  return z.object({
    name: z.string().min(2, {
      error: t("common.errors.testRunNameMinLength"),
    }),
    configIds: z.array(z.number()),
    milestoneId: z.number().nullable(),
    stateId: z.number().min(1, {
      error: t("common.errors.stateRequiredDot"),
    }),
    note: z.any().nullable(),
    docs: z.any().nullable(),
    attachments: z.array(z.any()).optional(),
  });
}

function buildBaseFormSchema(t: (key: any) => string) {
  return z.object({
    name: z.string().min(2, {
      error: t("common.errors.testRunNameMinLength"),
    }),
    configIds: z.array(z.number()),
    milestoneId: z.number().nullable(),
    stateId: z.number(),
    note: z.any().nullable(),
    docs: z.any().nullable(),
    attachments: z.array(z.any()).optional(),
    testCases: z.array(z.number()),
  });
}

type BasicInfoFormValues = z.infer<ReturnType<typeof buildBasicInfoFormSchema>>;
type BaseFormValues = z.infer<ReturnType<typeof buildBaseFormSchema>>;

// Step 1: Basic Information Dialog
const BasicInfoDialog = React.memo(
  ({
    open: _open,
    onClose,
    onNext,
    form,
    workflowsOptions,
    milestonesOptions,
    defaultWorkflow,
    configurationsOptions,
    selectedTags,
    setSelectedTags,
    selectedFiles: _selectedFiles,
    handleFileSelect,
    handleLinksChange,
    handleSelect,
    selectedAttachmentIndex,
    handleAttachmentClose,
    projectId,
    t,
    issueConfigId: _issueConfigId,
    linkedIssueIds,
    setLinkedIssueIds,
    canCreateTags = false,
  }: any) => {
    const tCommon = useTranslations("common");
    const tGlobal = useTranslations();
    const parentMilestoneId = form.getValues("milestoneId") ?? null;

    const basicInfoFormSchema = useMemo(
      () => buildBasicInfoFormSchema(tGlobal),
      [tGlobal]
    );
    const basicInfoForm = useForm<BasicInfoFormValues>({
      resolver: standardSchemaResolver(basicInfoFormSchema),
      defaultValues: {
        name: form.getValues("name"),
        configIds: form.getValues("configIds"),
        milestoneId: parentMilestoneId,
        stateId: form.getValues("stateId") || defaultWorkflow?.id,
        note: form.getValues("note"),
        docs: form.getValues("docs"),
        attachments: form.getValues("attachments"),
      },
      mode: "onChange",
    });

    useEffect(() => {
      basicInfoForm.setValue("milestoneId", parentMilestoneId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parentMilestoneId]);

    useEffect(() => {
      if (defaultWorkflow && !basicInfoForm.getValues("stateId")) {
        basicInfoForm.setValue("stateId", defaultWorkflow.id);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultWorkflow]);

    useEffect(() => {
      const mainFormMilestoneId = form.getValues("milestoneId");
      if (mainFormMilestoneId !== null && mainFormMilestoneId !== undefined) {
        basicInfoForm.setValue("milestoneId", mainFormMilestoneId);
        setTimeout(() => {
          void basicInfoForm.trigger("milestoneId");
        }, 10);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleNextStep = async () => {
      const result = await basicInfoForm.trigger([
        "name",
        "configIds",
        "milestoneId",
        "stateId",
        "note",
        "docs",
        "attachments",
      ]);
      if (result) {
        const values = basicInfoForm.getValues();
        form.setValue("milestoneId", values.milestoneId);
        form.setValue("configIds", values.configIds);
        Object.keys(values).forEach((key) => {
          if (key !== "milestoneId" && key !== "configIds") {
            form.setValue(key as any, values[key as keyof typeof values]);
          }
        });
        onNext();
      }
    };

    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <Form {...basicInfoForm}>
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-[60%_5%_35%]">
              <div className="space-y-4">
                <FormField
                  control={basicInfoForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("name")}
                        <HelpPopover helpKey="testRun.name" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="run-name-input" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={basicInfoForm.control}
                  name="note"
                  render={({ field }) => {
                    let editorContent = emptyEditorContent;
                    if (typeof field.value === "string" && field.value) {
                      try {
                        editorContent = JSON.parse(field.value);
                      } catch {}
                    }
                    return (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          {tCommon("fields.description")}
                          <HelpPopover helpKey="testRun.description" />
                        </FormLabel>
                        <FormControl>
                          <TipTapEditor
                            key="editing-note"
                            content={editorContent}
                            onUpdate={(newContent) =>
                              field.onChange(newContent)
                            }
                            readOnly={false}
                            className="h-auto max-h-[150px]"
                            placeholder={tCommon(
                              "fields.description_placeholder"
                            )}
                            projectId={projectId}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
                <FormField
                  control={basicInfoForm.control}
                  name="configIds"
                  render={({ field }) => {
                    // Convert IDs to configuration objects for the combobox
                    const selectedConfigs = configurationsOptions
                      .filter((c: ConfigurationOption) =>
                        (field.value ?? []).includes(c.id)
                      )
                      .map((c: ConfigurationOption) => ({
                        id: c.id,
                        name: c.name,
                      }));

                    // Fetch function for async search
                    const fetchConfigurations = async (
                      query: string,
                      page: number,
                      pageSize: number
                    ) => {
                      const filtered = configurationsOptions.filter(
                        (c: ConfigurationOption) =>
                          c.name.toLowerCase().includes(query.toLowerCase())
                      );
                      const start = page * pageSize;
                      const results = filtered.slice(start, start + pageSize);
                      return { results, total: filtered.length };
                    };

                    return (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          {tCommon("fields.configurations")}
                          {selectedConfigs.length > 0 && (
                            <span className="ms-1 text-muted-foreground">
                              {"("}
                              {selectedConfigs.length}
                              {")"}
                            </span>
                          )}
                          <HelpPopover helpKey="testRun.configuration" />
                        </FormLabel>
                        <FormControl>
                          <MultiAsyncCombobox<ConfigurationOption>
                            value={selectedConfigs}
                            ariaLabel={tCommon("fields.configurations")}
                            hideSelected={true}
                            onValueChange={(configs) => {
                              field.onChange(configs.map((c) => c.id));
                            }}
                            fetchOptions={fetchConfigurations}
                            renderOption={(config) => (
                              <div className="flex items-center gap-2">
                                <Combine className="w-4 h-4" />
                                {config.name}
                              </div>
                            )}
                            renderSelectedOption={(config) => (
                              <span className="flex items-center gap-1 min-w-0">
                                <Combine className="w-3 h-3 shrink-0" />
                                <span className="truncate">{config.name}</span>
                              </span>
                            )}
                            getOptionValue={(config) => config.id}
                            getOptionLabel={(config) => config.name}
                            placeholder={tCommon(
                              "placeholders.selectConfigurations"
                            )}
                            showTotal
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
                <FormField
                  control={basicInfoForm.control}
                  name="milestoneId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.milestone")}
                        <HelpPopover helpKey="testRun.milestone" />
                      </FormLabel>
                      <FormControl>
                        <MilestoneSelect
                          key={`milestone-select-${field.value || "none"}`}
                          value={field.value}
                          onChange={(val) =>
                            field.onChange(val === "none" ? null : Number(val))
                          }
                          milestones={milestonesOptions}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={basicInfoForm.control}
                  name="docs"
                  render={({ field }) => {
                    let editorContent = emptyEditorContent;
                    if (typeof field.value === "string" && field.value) {
                      try {
                        editorContent = JSON.parse(field.value);
                      } catch {}
                    } else if (
                      typeof field.value === "object" &&
                      field.value &&
                      field.value.type === "doc"
                    ) {
                      editorContent = field.value;
                    }
                    return (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          {tCommon("fields.documentation")}
                          <HelpPopover helpKey="testRun.docs" />
                        </FormLabel>
                        <FormControl>
                          <TipTapEditor
                            key="editing-docs"
                            content={editorContent}
                            onUpdate={(newContent) =>
                              field.onChange(newContent)
                            }
                            readOnly={false}
                            className="h-auto max-h-[150px]"
                            placeholder={tCommon("placeholders.docs")}
                            projectId={projectId}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </div>
              <div className="flex items-center justify-center">
                <Separator orientation="vertical" className="h-full" />
              </div>
              <div className="space-y-4">
                <FormField
                  control={basicInfoForm.control}
                  name="stateId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.state")}
                        <HelpPopover helpKey="testRun.state" />
                      </FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(Number(value))}
                        value={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger aria-label={tCommon("fields.state")}>
                            <SelectValue
                              placeholder={tCommon("placeholders.selectState")}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectGroup>
                            {workflowsOptions.map((option: WorkflowOption) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                                disabled={option.disabledForCreate === true}
                              >
                                <WorkflowStateDisplay
                                  state={{
                                    name: option.label,
                                    icon: {
                                      name: (option.icon ?? "") as IconName,
                                    },
                                    color: { value: option.color ?? "" },
                                    requiresReview: option.requiresReview,
                                  }}
                                  size="sm"
                                />
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {workflowsOptions.some(
                        (o: WorkflowOption) => o.disabledForCreate === true
                      ) && (
                        <FormDescription>
                          {tGlobal(
                            "reviews.transitionGate.gatedStatesNotSelectable"
                          )}
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div>
                  <FormLabel className="flex items-center mb-2">
                    {tCommon("fields.tags")}
                    <HelpPopover helpKey="testRun.tags" />
                  </FormLabel>
                  <ManageTags
                    selectedTags={selectedTags}
                    setSelectedTags={setSelectedTags}
                    canCreateTags={canCreateTags}
                  />
                </div>
                <FormLabel className="flex items-center mb-2">
                  {tCommon("fields.issues")}
                  <HelpPopover helpKey="testRun.issues" />
                </FormLabel>
                <div className="max-h-40 overflow-y-auto">
                  <UnifiedIssueManager
                    projectId={Number(projectId)}
                    linkedIssueIds={linkedIssueIds}
                    setLinkedIssueIds={setLinkedIssueIds}
                    entityType="testRun"
                    maxBadgeWidth="max-w-48"
                  />
                </div>
                <FormField
                  control={basicInfoForm.control}
                  name="attachments"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.attachments")}
                        <HelpPopover helpKey="testRun.attachments" />
                      </FormLabel>
                      <FormControl>
                        <div className="space-y-4">
                          <UploadAttachments
                            onFileSelect={handleFileSelect}
                            allowLinks
                            onLinksChange={handleLinksChange}
                          />
                          <AttachmentsDisplay
                            attachments={(field.value as Attachments[]) || []}
                            preventEditing={false}
                            onSelect={handleSelect}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleNextStep}
                data-testid="run-next-button"
              >
                {tCommon("actions.next")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
        {selectedAttachmentIndex !== null && (
          <AttachmentsCarousel
            attachments={[]}
            initialIndex={selectedAttachmentIndex}
            onClose={handleAttachmentClose}
            canEdit={false}
          />
        )}
      </>
    );
  }
);
BasicInfoDialog.displayName = "BasicInfoDialog";

interface ForecastData {
  manualEstimate: number;
  mixedEstimate: number;
  automatedEstimate: number;
  areAllCasesAutomated: boolean;
  fetchedTestCasesCount?: number;
}

// Step 2: Test Cases Selection Dialog
const TestCasesDialog = React.memo(
  ({
    open,
    onClose: _onClose,
    onPrevious,
    onNext,
    selectedTestCases,
    setSelectedTestCases,
    t: _t,
    tCommon,
    form,
    projectId,
    linkedIssueIds,
    numericProjectId,
    onPreflightResult,
    onPreflightChipClick,
    preflightClassification,
  }: any) => {
    const tRepository = useTranslations("repository");
    // Live config selection from the parent form — drives the preflight chip
    // alongside the modal's selectedTestCases. Using `useWatch` keeps the
    // chip in sync without re-rendering the entire TestCasesDialog tree.
    const watchedConfigIds: number[] =
      (useWatch({ control: form.control, name: "configIds" }) as number[]) ??
      [];
    // Local pagination state for the modal (independent from parent page)
    const [modalCurrentPage, setModalCurrentPage] = useState(1);
    const [modalPageSize, setModalPageSize] = useState<number>(10);
    const [modalTotalItems, setModalTotalItems] = useState(0);

    const [forecastData, setForecastData] = useState<ForecastData | null>(null);
    const [isLoadingForecast, setIsLoadingForecast] = useState(false);

    // Fetch test cases using POST to avoid URL length limits
    const [fetchedTestCases, setFetchedTestCases] = useState<any[]>([]);
    const [isLoadingTestCasesForDrawer, setIsLoadingTestCasesForDrawer] =
      useState(false);

    useEffect(() => {
      const fetchTestCases = async () => {
        if (selectedTestCases.length === 0 || !open) {
          setFetchedTestCases([]);
          return;
        }

        setIsLoadingTestCasesForDrawer(true);
        try {
          const response = await fetch(
            `/api/projects/${projectId}/cases/fetch-many`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                caseIds: selectedTestCases,
              }),
            }
          );

          if (!response.ok) {
            throw new Error("Failed to fetch test cases");
          }

          const data = await response.json();
          setFetchedTestCases(data.cases || []);
        } catch (error) {
          console.error("Error fetching test cases:", error);
          setFetchedTestCases([]);
        } finally {
          setIsLoadingTestCasesForDrawer(false);
        }
      };

      void fetchTestCases();
    }, [selectedTestCases, open, projectId]);

    useEffect(() => {
      const fetchForecast = async () => {
        if (selectedTestCases.length === 0) {
          setForecastData({
            manualEstimate: 0,
            mixedEstimate: 0,
            automatedEstimate: 0,
            areAllCasesAutomated: false,
          });
          setIsLoadingForecast(false);
          return;
        }
        setIsLoadingForecast(true);
        try {
          const response = await fetch("/api/repository-cases/forecast", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ caseIds: selectedTestCases }),
          });
          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }
          const data: ForecastData = await response.json();
          setForecastData(data);
        } catch (error) {
          console.error("Failed to fetch forecast data:", error);
          setForecastData(null); // Or handle error state appropriately
        } finally {
          setIsLoadingForecast(false);
        }
      };

      if (open) {
        void fetchForecast();
      }
    }, [selectedTestCases, open]);

    // Map fetchedTestCases to the structure expected by SelectedTestCasesDrawer
    const _mappedTestCasesForDrawer = useMemo(() => {
      if (!fetchedTestCases) return [];
      return fetchedTestCases.map((tc) => ({
        id: tc.id,
        name: tc.name,
        state: {
          name: tc.state.name,
          icon: tc.state.icon ? { name: tc.state.icon.name } : undefined,
          color: tc.state.color ? { value: tc.state.color.value } : undefined,
        },
        estimate: tc.estimate === null ? undefined : tc.estimate,
        forecastManual:
          tc.forecastManual === null ? undefined : tc.forecastManual,
        forecastAutomated:
          tc.forecastAutomated === null ? undefined : tc.forecastAutomated,
        source: tc.source,
      }));
    }, [fetchedTestCases]);

    useEffect(() => {
      if (form && open) {
        form.setValue("testCases", selectedTestCases);
      } else if (
        form &&
        open &&
        (!selectedTestCases || selectedTestCases.length === 0)
      ) {
        form.setValue("testCases", []);
      }
    }, [selectedTestCases, form, open]);

    return (
      <>
        <DialogHeader className="p-6 pb-0 pe-4">
          <DialogTitle>{tRepository("cases.selectCases")}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex justify-between items-start text-muted-foreground">
              <div className="flex items-center gap-4">
                <MagicSelectButton
                  projectId={Number(projectId)}
                  testRunMetadata={{
                    name: form.getValues("name"),
                    description: form.getValues("note"),
                    docs: form.getValues("docs"),
                    linkedIssueIds: linkedIssueIds || [],
                  }}
                  selectedTestCases={selectedTestCases}
                  onSuggestionsAccepted={setSelectedTestCases}
                />
                <div className="flex items-start text-sm divide-x divide-muted-foreground">
                  {(isLoadingForecast || isLoadingTestCasesForDrawer) &&
                  selectedTestCases.length > 0 ? (
                    <div className="px-2">
                      <LoadingSpinner className="w-4 h-4" />
                    </div>
                  ) : forecastData ? (
                    <>
                      {forecastData.manualEstimate > 0 && (
                        <div className="px-2">
                          <ForecastDisplay
                            seconds={forecastData.manualEstimate}
                            className="text-xs"
                            type="manual"
                          />
                        </div>
                      )}
                      {forecastData.automatedEstimate > 0 && (
                        <div className="px-2">
                          <ForecastDisplay
                            seconds={forecastData.automatedEstimate}
                            type="automated"
                            className="text-xs"
                            round={false}
                          />
                        </div>
                      )}
                      {forecastData.mixedEstimate > 0 &&
                        forecastData.mixedEstimate !==
                          forecastData.manualEstimate &&
                        forecastData.mixedEstimate !==
                          forecastData.automatedEstimate && (
                          <div className="px-2">
                            <ForecastDisplay
                              seconds={forecastData.mixedEstimate}
                              type="mixed"
                              className="text-xs"
                              round={false}
                            />
                          </div>
                        )}
                    </>
                  ) : null}
                </div>
              </div>
              <SelectedTestCasesDrawer
                selectedTestCases={selectedTestCases}
                onSelectionChange={setSelectedTestCases}
                projectId={Number(projectId)}
              />
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ProjectRepository
            isSelectionMode={true}
            selectedTestCases={selectedTestCases}
            onSelectionChange={setSelectedTestCases}
            onConfirm={() => {}} // This seems unused, check if it should be removed or used for onNext
            hideHeader={true}
            projectId={projectId}
            ApplicationArea={ApplicationArea.TestCaseRepository}
            // Pass local pagination state to override context
            overridePagination={{
              currentPage: modalCurrentPage,
              setCurrentPage: setModalCurrentPage,
              pageSize: modalPageSize,
              setPageSize: setModalPageSize,
              totalItems: modalTotalItems,
              setTotalItems: setModalTotalItems,
            }}
            // Skip DnD provider since this modal may be opened from a page that already has one
            skipDndProvider={true}
          />
        </div>
        <div className="p-6 bg-background border-t flex justify-end items-center gap-2">
          {selectedTestCases.length > 0 && numericProjectId ? (
            <div className="me-auto">
              <RunPreflightChip
                caseIds={selectedTestCases}
                configIds={watchedConfigIds}
                projectId={numericProjectId}
                onResult={onPreflightResult}
                onClick={onPreflightChipClick}
              />
            </div>
          ) : null}
          <Button variant="outline" onClick={onPrevious}>
            {tCommon("actions.back")}
          </Button>
          <Button
            onClick={onNext}
            disabled={
              isLoadingForecast ||
              isLoadingTestCasesForDrawer ||
              preflightClassification === "hardRefuse"
            }
            data-testid="run-save-button"
          >
            {tCommon("actions.save")}
          </Button>
        </div>
      </>
    );
  }
);
TestCasesDialog.displayName = "TestCasesDialog";

// Interface for duplication preset (copied from DuplicateTestRunDialog.tsx for now)
interface AddRunModalDuplicationPreset {
  originalRunId: number;
  copyAssignments: "copy" | "unassign";
  originalName: string;
  originalConfigId: number | null;
  originalMilestoneId: number | null;
  originalStateId: number | null;
  originalNote?: any;
  originalDocs?: any;
  /** Copies join the source run's configuration group instead of forming one. */
  joinSourceGroup?: boolean;
  /** The source run's group when the duplicate options were confirmed. */
  originalConfigurationGroupId?: string | null;
}

interface AddTestRunModalProps {
  defaultMilestoneId?: number;
  open: boolean;
  onClose: () => void;
  initialSelectedCaseIds: number[];
  onSelectedCasesChange: (cases: number[]) => void;
  duplicationPreset?: AddRunModalDuplicationPreset;
  /** Issues to pre-link on open (e.g. create-run-from-milestone-issues). */
  initialLinkedIssueIds?: number[];
}

export default function AddTestRunModal({
  defaultMilestoneId,
  open,
  onClose,
  initialSelectedCaseIds,
  onSelectedCasesChange,
  duplicationPreset,
  initialLinkedIssueIds,
}: AddTestRunModalProps) {
  const formInitializedRef = useRef(false);
  const [step, setStep] = useState(0);
  const [selectedCaseIds, setSelectedCaseIds] = useState<number[]>(
    initialSelectedCaseIds || []
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<LinkAttachmentInput[]>([]);
  // Latest cardinality preflight result reported by the chip in Step 1.
  // Drives the soft-confirm gate + hard-refuse breakdown dialog.
  const [preflightResult, setPreflightResult] = useState<
    PreflightResult | undefined
  >(undefined);
  const [hardRefuseDialogOpen, setHardRefuseDialogOpen] = useState(false);
  const [softConfirmDialogOpen, setSoftConfirmDialogOpen] = useState(false);
  // Set to true once the user accepts the soft-confirm dialog, so the next
  // call to onSubmit bypasses the gate and proceeds to create the run.
  const softConfirmAcceptedRef = useRef(false);

  const { data: session } = useSession();
  const { projectId } = useParams();
  const numericProjectId = Number(projectId);
  const t = useTranslations("runs.add");
  const tCommon = useTranslations("common");
  const tParameters = useTranslations("parameters");
  const tGlobal = useTranslations();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [creationProgress, setCreationProgress] = useState({
    current: 0,
    total: 0,
  });
  const router = useRouter();

  const [linkedIssueIds, setLinkedIssueIds] = useState<number[]>([]);

  const { mutateAsync: createTestRuns } =
    useClientQueries(schema).testRuns.useCreate();
  const { mutateAsync: updateTestRun } =
    useClientQueries(schema).testRuns.useUpdate();
  const { mutateAsync: createAttachments } =
    useClientQueries(schema).attachments.useCreate();

  // `excludeNotStartedFromRuns` is the per-project toggle that hides NOT_STARTED
  // workflow-state cases from runs. We read it here so the submit handler can
  // defensively filter the selected ids before composing the testCases.create
  // payload — without this, a user picking a stale page state could still get a
  // draft case added to a run after the admin flipped the toggle on. Cheap one-
  // row read; the picker-side filter (UI hide) is tracked as a follow-up.
  const { data: projectFlag } = useClientQueries(schema).projects.useFindUnique(
    {
      where: { id: Number(projectId) },
      select: { excludeNotStartedFromRuns: true },
    },
    { enabled: Number.isFinite(Number(projectId)) }
  );
  const { data: configurations } = useClientQueries(
    schema
  ).configurations.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId: Number(projectId) } },
    },
    orderBy: { name: "asc" },
  });
  const { data: workflows } = useClientQueries(schema).workflows.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "RUNS",
      projects: { some: { projectId: Number(projectId) } },
    },
    include: { icon: true, color: true },
    orderBy: { order: "asc" },
  });
  const { data: milestones } = useClientQueries(schema).milestones.useFindMany({
    where: {
      projectId: Number(projectId),
      isDeleted: false,
      // Completed milestones aren't offered — except a caller-provided
      // default (create-run-from-milestone on a closed sprint), which must
      // be visible or the preset would silently ride along as a hidden
      // form value.
      ...(defaultMilestoneId != null
        ? { OR: [{ isCompleted: false }, { id: defaultMilestoneId }] }
        : { isCompleted: false }),
    },
    include: {
      milestoneType: { include: { icon: true } },
      children: { include: { milestoneType: { include: { icon: true } } } },
    },
  });
  useClientQueries(schema).tags.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });

  const defaultWorkflow = workflows?.find((workflow) => workflow.isDefault);
  const configurationsOptions: ConfigurationOption[] =
    configurations?.map((c) => ({ id: c.id, name: c.name })) || [];
  // `null` for system admins — they bypass the review gate on create (see
  // `resolveCreateStateRemap`), so no state option is disabled.
  const isSystemAdminForGate = session?.user?.access === "ADMIN";
  const firstGatedRunOrder = useMemo(() => {
    if (isSystemAdminForGate) return null;
    return (workflows ?? [])
      .filter((w) => w.requiresReview === true)
      .reduce<number | null>(
        (acc, w) => (acc === null || w.order < acc ? w.order : acc),
        null
      );
  }, [workflows, isSystemAdminForGate]);
  const workflowsOptions = useMemo(() => {
    return (
      workflows?.map((w) => ({
        value: w.id.toString(),
        label: w.name,
        icon: w.icon?.name,
        color: w.color?.value,
        requiresReview: w.requiresReview,
        disabledForCreate:
          firstGatedRunOrder !== null && w.order >= firstGatedRunOrder,
      })) || []
    );
  }, [workflows, firstGatedRunOrder]);
  // Shared transform (NOT a hand-rolled map): it carries the tracker
  // linkage fields through, so the picker can mark Jira-synced milestones
  // with the source icon.
  const milestonesOptions = transformMilestones(milestones || []);

  // Dialog close handler — the parent conditionally mounts this component,
  // so React unmounts and discards form/local state on close. No manual reset
  // is needed; we just tell the parent to unmount us.
  const mainDialogOnOpenChange = (newOpenState: boolean) => {
    if (!newOpenState) {
      onClose();
    }
  };

  const baseFormSchema = useMemo(() => buildBaseFormSchema(tGlobal), [tGlobal]);
  const form = useForm<BaseFormValues>({
    resolver: standardSchemaResolver(baseFormSchema),
    defaultValues: {
      name: duplicationPreset
        ? `${duplicationPreset.originalName} - ${tCommon("actions.duplicate")}`
        : "",
      configIds: duplicationPreset?.originalConfigId
        ? [duplicationPreset.originalConfigId]
        : [],
      milestoneId: duplicationPreset
        ? duplicationPreset.originalMilestoneId
        : defaultMilestoneId,
      stateId: duplicationPreset
        ? duplicationPreset.originalStateId || defaultWorkflow?.id
        : defaultWorkflow?.id,
      note: duplicationPreset
        ? duplicationPreset.originalNote
        : JSON.stringify(emptyEditorContent),
      docs: duplicationPreset
        ? duplicationPreset.originalDocs
        : JSON.stringify(emptyEditorContent),
      attachments: [],
      testCases: initialSelectedCaseIds || [],
    },
    mode: "onChange",
  });

  const {
    handleSubmit,
    reset,
    formState: { errors: _errors },
    setValue,
  } = form;

  // Merged useEffect for form initialization and reset
  // Only runs once per dialog open to prevent wiping user-entered data on re-renders
  useEffect(() => {
    if (!open) {
      formInitializedRef.current = false;
      return;
    }
    if (formInitializedRef.current) return;
    // Both init branches below need the default workflow — claiming
    // "initialized" before it loads (a fresh page load opening straight
    // into the dialog) skipped initialization entirely, so presets like
    // initialLinkedIssueIds never applied.
    if (!defaultWorkflow) return;
    formInitializedRef.current = true;

    if (duplicationPreset && defaultWorkflow) {
      let parsedNote = emptyEditorContent;
      if (duplicationPreset.originalNote) {
        if (typeof duplicationPreset.originalNote === "string") {
          try {
            const parsed = JSON.parse(duplicationPreset.originalNote);
            if (parsed && typeof parsed === "object" && parsed.type === "doc") {
              parsedNote = parsed;
            } else {
              // console.warn(
              //   "Original note string was not valid Tiptap JSON, using empty."
              // );
            }
          } catch (e) {
            console.error(
              "Failed to parse originalNote from string:",
              e,
              duplicationPreset.originalNote
            );
          }
        } else if (
          typeof duplicationPreset.originalNote === "object" &&
          duplicationPreset.originalNote.type === "doc"
        ) {
          parsedNote = duplicationPreset.originalNote;
        } else {
          // console.warn(
          //   "Original note was not a string or valid Tiptap JSON object, using empty."
          // );
        }
      }

      let parsedDocs = emptyEditorContent;
      if (duplicationPreset.originalDocs) {
        if (typeof duplicationPreset.originalDocs === "string") {
          try {
            const parsed = JSON.parse(duplicationPreset.originalDocs);
            if (parsed && typeof parsed === "object" && parsed.type === "doc") {
              parsedDocs = parsed;
            } else {
              // console.warn(
              //   "Original docs string was not valid Tiptap JSON, using empty."
              // );
            }
          } catch (e) {
            console.error(
              "Failed to parse originalDocs from string:",
              e,
              duplicationPreset.originalDocs
            );
          }
        } else if (
          typeof duplicationPreset.originalDocs === "object" &&
          duplicationPreset.originalDocs.type === "doc"
        ) {
          parsedDocs = duplicationPreset.originalDocs;
        } else {
          // console.warn(
          //   "Original docs were not a string or valid Tiptap JSON object, using empty."
          // );
        }
      }

      const isValidState = workflowsOptions.some(
        (wf) => wf.value === duplicationPreset.originalStateId?.toString()
      );
      const stateToUse =
        isValidState && duplicationPreset.originalStateId
          ? duplicationPreset.originalStateId
          : defaultWorkflow.id;

      reset({
        name: `${duplicationPreset.originalName} - ${tCommon("actions.duplicate")}`,
        configIds: duplicationPreset.originalConfigId
          ? [duplicationPreset.originalConfigId]
          : [],
        milestoneId: duplicationPreset.originalMilestoneId,
        stateId: stateToUse,
        note: parsedNote,
        docs: parsedDocs,
        attachments: [],
        testCases: initialSelectedCaseIds,
      });
      setSelectedTags([]);
      setLinkedIssueIds([]);
    } else if (!duplicationPreset && defaultWorkflow) {
      const milestoneId =
        defaultMilestoneId !== undefined ? defaultMilestoneId : null;
      reset({
        name: "",
        configIds: [],
        stateId: defaultWorkflow.id,
        note: emptyEditorContent,
        docs: emptyEditorContent,
        milestoneId: milestoneId,
        attachments: [],
        testCases: initialSelectedCaseIds,
      });
      setSelectedTags([]);
      setLinkedIssueIds(initialLinkedIssueIds ?? []);
    }
    // This effect should run when the modal opens or when key dependencies for defaults change.
    // Explicitly not including `reset` in deps as it's stable, but form values depend on these.
  }, [
    open,
    duplicationPreset,
    defaultWorkflow,
    initialSelectedCaseIds,
    defaultMilestoneId,
    initialLinkedIssueIds,
    workflowsOptions,
    reset,
    tCommon,
  ]);

  // Sync selectedCaseIds when initialSelectedCaseIds changes (e.g., from sessionStorage)
  useEffect(() => {
    if (open && initialSelectedCaseIds && initialSelectedCaseIds.length > 0) {
      setSelectedCaseIds(initialSelectedCaseIds);
    }
  }, [open, initialSelectedCaseIds]);

  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const _userName = session?.user?.name || "Unknown User";
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [, setSelectedAttachments] = useState<Attachments[]>([]);

  const handleSelect = (attachments: Attachments[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };
  const handleAttachmentClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };
  const handleFileSelect = (files: File[]) => {
    setSelectedFiles(files);
  };

  const uploadFiles = async (testRunId: number) => {
    const prependString = session!.user.id;
    const sanitizedFolder = projectId?.toString() || "";
    const attachmentsPromises = selectedFiles.map(async (file) => {
      const fileUrl = await fetchSignedUrl(
        file,
        `/api/get-attachment-url/`,
        `${sanitizedFolder}/${prependString}`
      );
      const attachment = await createAttachments({
        data: {
          testRuns: { connect: { id: testRunId } },
          url: fileUrl,
          name: file.name,
          note: "",
          mimeType: file.type,
          size: BigInt(file.size),
          createdBy: { connect: { id: session!.user.id } },
        },
      });
      return {
        id: attachment?.id,
        url: fileUrl,
        name: file.name,
        note: "",
        mimeType: file.type,
        size: file.size,
        createdBy: session!.user.name,
      };
    });
    const linkPromises = selectedLinks.map(async (link) => {
      const attachment = await createAttachments({
        data: {
          testRuns: { connect: { id: testRunId } },
          url: link.url,
          name: link.name,
          note: link.note ?? "",
          mimeType: link.mimeType,
          size: BigInt(link.size),
          createdBy: { connect: { id: session!.user.id } },
        },
      });
      return {
        id: attachment?.id,
        url: link.url,
        name: link.name,
        note: link.note ?? "",
        mimeType: link.mimeType,
        size: link.size,
        createdBy: session!.user.name,
      };
    });
    return Promise.all([...attachmentsPromises, ...linkPromises]);
  };

  const _handleConfirmSelection = (selectedIds: number[]) => {
    onSelectedCasesChange(selectedIds);
    setValue("testCases", selectedIds);
  };

  const handleNext = () => {
    if (step === 1) {
      setValue("testCases", selectedCaseIds); // Ensure selectedCaseIds from state is used

      // Cardinality gate (Surface E.1/E.3): block hardRefuse, soft-confirm in
      // the warning band. Server-side enforcement still applies — this just
      // saves a round-trip and surfaces the friction sooner.
      if (preflightResult && !softConfirmAcceptedRef.current) {
        if (preflightResult.classification === "hardRefuse") {
          setHardRefuseDialogOpen(true);
          return;
        }
        if (preflightResult.classification === "softConfirm") {
          setSoftConfirmDialogOpen(true);
          return;
        }
      }
      // Reset the soft-confirm latch after one use so subsequent submissions
      // re-evaluate the (possibly-changed) cardinality band.
      softConfirmAcceptedRef.current = false;

      void handleSubmit(onSubmit, (errors) => {
        console.error("Form validation errors:", errors);
      })();
    } else {
      setStep((prev) => prev + 1);
    }
  };

  const handlePrevious = () => {
    setStep((prev) => prev - 1);
  };

  const { permissions: tagsPermissions } = useProjectPermissions(
    numericProjectId,
    ApplicationArea.Tags
  );
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;
  const isSuperAdmin = session?.user?.access === "ADMIN";
  const showAddEditTagsPerm = canAddEditTags || isSuperAdmin;

  if (!session || !session.user.access) {
    return null;
  }

  async function onSubmit(data: BaseFormValues) {
    if (!session?.user?.id) {
      toast.error(tCommon("errors.notAuthenticated.title"), {
        description: tCommon("errors.notAuthenticated.message"),
      });
      return;
    }
    setIsSubmitting(true);
    // Hoisted so the catch below can tell whether the source run was stamped
    // with a freshly minted group id but ended up with no siblings.
    const createdRuns: any[] = [];
    let stampedSourceRunId: number | null = null;
    try {
      let assignmentsToCopy: {
        repositoryCaseId: number;
        userId: string | null;
      }[] = [];

      if (duplicationPreset && duplicationPreset.copyAssignments === "copy") {
        if (data.testCases && data.testCases.length > 0) {
          const assignmentPayload = {
            originalRunId: duplicationPreset.originalRunId,
            repositoryCaseIds: data.testCases,
          };
          const response: GetAssignmentsResponse =
            await getAssignmentsForRunCases(assignmentPayload);

          if (response.success) {
            assignmentsToCopy = response.data;
          } else {
            console.error(
              "Failed to fetch assignments for duplication:",
              response.error,
              response.issues
            );
            toast.error(tCommon("errors.failedToFetchAssignments.title"), {
              description:
                response.error ||
                tCommon("errors.failedToFetchAssignments.message"),
            });
          }
        }
      }

      // Per-project "exclude draft cases from runs" rule. When the flag is on,
      // drop any selected case whose current workflow state is NOT_STARTED
      // before composing the testCases.create payload. The picker may still
      // show them (picker-side hide is tracked as a follow-up), so this is the
      // defensive client-side gate. A toast surfaces the count so the user
      // isn't surprised by a missing case after the run is created.
      let eligibleTestCaseIds: number[] = data.testCases;
      if (projectFlag?.excludeNotStartedFromRuns && data.testCases.length) {
        try {
          const probe = await fetch(
            "/api/model/repositoryCases/findMany?q=" +
              encodeURIComponent(
                JSON.stringify({
                  where: {
                    id: { in: data.testCases },
                    projectId: Number(projectId),
                    isDeleted: false,
                  },
                  select: {
                    id: true,
                    state: { select: { workflowType: true } },
                  },
                })
              )
          );
          const probeJson = await probe.json();
          const rows: Array<{
            id: number;
            state: { workflowType: string } | null;
          }> = probeJson?.data ?? [];
          const eligibleSet = new Set(
            rows
              .filter((r) => r.state?.workflowType !== "NOT_STARTED")
              .map((r) => r.id)
          );
          const filtered = data.testCases.filter((id) => eligibleSet.has(id));
          const droppedCount = data.testCases.length - filtered.length;
          if (droppedCount > 0) {
            toast.warning(
              tGlobal(
                "projects.settings.advanced.excludeNotStarted.skippedToast",
                { count: droppedCount }
              )
            );
          }
          eligibleTestCaseIds = filtered;
        } catch (err) {
          console.error(
            "[AddTestRunModal] eligibility probe failed; proceeding with original selection",
            err
          );
        }
      }

      const testCasesCreateData = eligibleTestCaseIds.map(
        (repoCaseId, index) => {
          const assignment = assignmentsToCopy.find(
            (a) => a.repositoryCaseId === repoCaseId
          );
          const assignmentData = assignment?.userId
            ? { assignedTo: { connect: { id: assignment.userId } } }
            : {};

          return {
            repositoryCase: { connect: { id: repoCaseId } },
            order: index,
            ...assignmentData,
          };
        }
      );

      // Determine configs to create runs for
      const configsToCreate =
        data.configIds.length > 0 ? data.configIds : [null];

      // Which configuration group the new runs land in. Without a duplication
      // preset this is the historical rule (a fresh group only when 2+ configs
      // are picked). Duplicating with "join the source's group" on puts every
      // copy — even a single one — in the source's group instead.
      const groupPlan = planDuplicationGroup({
        configCount: configsToCreate.length,
        joinSourceGroup: duplicationPreset?.joinSourceGroup === true,
        sourceGroupId: duplicationPreset?.originalConfigurationGroupId ?? null,
      });
      const configurationGroupId = groupPlan.configurationGroupId;

      // The source has no group yet, so it has to be stamped with the minted
      // id as well — otherwise the copies group up without it, which is the
      // defect this option exists to fix. Done BEFORE the runs are created so
      // a failure here aborts with nothing created; the catch below undoes it
      // if every create then fails and the source would be left alone in it.
      if (
        groupPlan.stampSource &&
        duplicationPreset &&
        configurationGroupId !== null
      ) {
        await updateTestRun({
          where: { id: duplicationPreset.originalRunId },
          data: { configurationGroupId },
        });
        stampedSourceRunId = duplicationPreset.originalRunId;
      }

      setCreationProgress({ current: 0, total: configsToCreate.length });

      for (const configId of configsToCreate) {
        const createData = {
          name: data.name,
          configId: configId,
          milestoneId: data.milestoneId || null,
          stateId: data.stateId,
          note: data.note
            ? JSON.stringify(data.note)
            : JSON.stringify(emptyEditorContent),
          docs: data.docs
            ? JSON.stringify(data.docs)
            : JSON.stringify(emptyEditorContent),
          projectId: Number(projectId),
          createdById: session.user.id,
          configurationGroupId: configurationGroupId,
          // Provenance marker so the create emits test_run.duplicated.
          ...(duplicationPreset
            ? { duplicatedFromId: duplicationPreset.originalRunId }
            : {}),
          tags: {
            connect: selectedTags.map((tagId) => ({ id: tagId })),
          },
          issues: {
            connect: linkedIssueIds.map((issueId) => ({ id: issueId })),
          },
          testCases: {
            create: testCasesCreateData,
          },
          testRunType: TestRunType.REGULAR,
        };

        const newTestRun = await createTestRuns({
          data: createData,
        });

        if (newTestRun) {
          createdRuns.push(newTestRun);
          setCreationProgress({
            current: createdRuns.length,
            total: configsToCreate.length,
          });

          // Only upload files to the first run (or we could duplicate to all)
          if (
            createdRuns.length === 1 &&
            (selectedFiles.length > 0 || selectedLinks.length > 0)
          ) {
            await uploadFiles(newTestRun.id);
          }

          await updateTestRunForecast(newTestRun.id);

          // Fan out iteration rows for any parameterized cases. Three
          // possible response shapes from /generate-iterations:
          //   - 422 hardRefuse  → toast.error with cap details
          //   - 200 async:true  → register on iterationProgressBus (Wave 3
          //                       toast/sidebar consumes the bus)
          //   - 200 async:false → invalidate ZenStack caches so iteration
          //                       counts surface immediately in the UI
          // Failures are non-fatal for the run itself — the run still
          // exists; only iteration generation failed. Surface the error
          // but do NOT throw (other configs in the loop should still get
          // their fan-out attempt).
          try {
            const fanOutRes = await fetch(
              `/api/test-runs/${newTestRun.id}/generate-iterations`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              }
            );
            const fanOutBody = await fanOutRes.json().catch(() => ({}));

            if (fanOutRes.status === 422 && fanOutBody?.refused) {
              toast.error(tParameters("runHardRefuseTitle"), {
                description: tParameters("runHardRefuseDescription", {
                  count: fanOutBody.iterationCount ?? 0,
                  cap: fanOutBody.cap ?? 0,
                }),
              });
            } else if (!fanOutRes.ok) {
              toast.error(tParameters("runProgressFailed"), {
                description: fanOutBody?.error ?? `HTTP ${fanOutRes.status}`,
              });
            } else if (fanOutBody?.async === true) {
              iterationProgressBus.start({
                jobId: String(fanOutBody.jobId),
                runId: newTestRun.id,
                runName: createData.name,
                total: fanOutBody.iterationCount ?? 0,
              });
            } else {
              // Sync path — invalidate ZenStack caches so iteration counts
              // appear in the UI without a manual refresh. Use the locked
              // ["zenstack", "ModelName"] prefix per Phase 2 carry-forward.
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ["zenstack", "TestRunCases"],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["zenstack", "TestRunCaseIteration"],
                }),
              ]);
            }
          } catch (fanOutErr) {
            // Network or JSON-parse failure — surface, don't throw.
            console.error("[generate-iterations]", fanOutErr);
            toast.error(tParameters("runProgressFailed"), {
              description:
                fanOutErr instanceof Error
                  ? fanOutErr.message
                  : String(fanOutErr),
            });
          }
        }
      }

      const runsCreated = createdRuns.length;
      toast.success(t("success.title"), {
        description:
          runsCreated > 1
            ? t("success.descriptionMultiple", {
                count: runsCreated,
                name: data.name,
              })
            : t("success.description", { name: data.name }),
      });
      onClose();
      router.refresh();
    } catch (error: any) {
      console.error("Failed to create test run:", error);
      // Nothing was created, so the group the source was just stamped with has
      // a single member. Auto-dissolve it by putting the source back.
      if (stampedSourceRunId !== null && createdRuns.length === 0) {
        try {
          await updateTestRun({
            where: { id: stampedSourceRunId },
            data: { configurationGroupId: null },
          });
        } catch (revertError) {
          console.error(
            "Failed to revert the source run's configuration group:",
            revertError
          );
        }
      }
      toast.error(tCommon("errors.failedToFetchAssignments.title"), {
        description:
          error.message || tCommon("errors.failedToFetchAssignments.message"),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const DialogContentComponent =
    open && step === 0
      ? BasicInfoDialog
      : open && step === 1
        ? TestCasesDialog
        : null;

  const dialogProps =
    open && step === 0
      ? {
          open: true,
          onClose: () => mainDialogOnOpenChange(false),
          onNext: handleNext,
          form: form,
          workflowsOptions: workflowsOptions,
          milestonesOptions: milestonesOptions,
          defaultWorkflow: defaultWorkflow,
          configurationsOptions: configurationsOptions,
          selectedTags: selectedTags,
          setSelectedTags: setSelectedTags,
          selectedFiles: selectedFiles,
          handleFileSelect: handleFileSelect,
          handleLinksChange: setSelectedLinks,
          handleSelect: handleSelect,
          selectedAttachmentIndex: selectedAttachmentIndex,
          handleAttachmentClose: handleAttachmentClose,
          projectId: projectId?.toString() || "",
          t: t,
          linkedIssueIds: linkedIssueIds,
          setLinkedIssueIds: setLinkedIssueIds,
          canCreateTags: showAddEditTagsPerm,
        }
      : open && step === 1
        ? {
            open: true,
            onClose: () => mainDialogOnOpenChange(false),
            onPrevious: handlePrevious,
            onNext: handleNext,
            selectedTestCases: selectedCaseIds, // Pass current state here
            setSelectedTestCases: setSelectedCaseIds, // Pass setter here
            t: t,
            tCommon: tCommon,
            form: form,
            projectId: projectId?.toString() || "",
            linkedIssueIds: linkedIssueIds,
            numericProjectId: numericProjectId,
            onPreflightResult: setPreflightResult,
            onPreflightChipClick: (r: PreflightResult) => {
              if (r.classification === "hardRefuse") {
                setHardRefuseDialogOpen(true);
              }
            },
            preflightClassification: preflightResult?.classification,
          }
        : {};

  if (isSubmitting) {
    const progressMessage =
      creationProgress.total > 1
        ? t("creatingProgress", {
            current: creationProgress.current,
            total: creationProgress.total,
          })
        : undefined;
    return <LoadingSpinnerAlert message={progressMessage} />;
  }

  const dialogContentClassName =
    step === 1
      ? "max-w-[1200px] h-[90vh] flex flex-col p-0"
      : "sm:max-w-[600px] lg:max-w-[1000px]";

  return (
    <>
      <Dialog open={open} onOpenChange={mainDialogOnOpenChange}>
        {open && (
          <DialogContent className={dialogContentClassName}>
            {DialogContentComponent && (
              <DialogContentComponent {...dialogProps} />
            )}
          </DialogContent>
        )}
      </Dialog>
      <RunCardinalityHardRefuseDialog
        open={hardRefuseDialogOpen}
        onOpenChange={setHardRefuseDialogOpen}
        result={preflightResult ?? null}
        configCount={form.watch("configIds")?.length ?? 0}
      />
      <RunCardinalitySoftConfirmDialog
        open={softConfirmDialogOpen}
        onOpenChange={setSoftConfirmDialogOpen}
        result={preflightResult ?? null}
        configCount={form.watch("configIds")?.length ?? 0}
        onConfirm={() => {
          softConfirmAcceptedRef.current = true;
          // Re-trigger handleNext now that the gate has been accepted.
          handleNext();
        }}
      />
    </>
  );
}
