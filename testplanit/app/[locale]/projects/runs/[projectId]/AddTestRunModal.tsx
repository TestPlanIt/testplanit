import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import {
  useFindManyConfigurations,
  useFindManyWorkflows,
  useCreateTestRuns,
  useFindManyMilestones,
  useFindManyProjectAssignment,
  useFindManyTags,
  useFindFirstProjects,
  useCreateAttachments,
} from "~/lib/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import { MilestoneSelect } from "@/components/forms/MilestoneSelect";
import { ManageTags } from "@/components/ManageTags";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { AttachmentsDisplay } from "@/components/AttachmentsDisplay";
import { ApplicationArea, Attachments, TestRunType } from "@prisma/client";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import UploadAttachments from "@/components/UploadAttachments";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { HelpPopover } from "@/components/ui/help-popover";
import { useTranslations, useLocale } from "next-intl";
import ProjectRepository from "../../repository/[projectId]/ProjectRepository";
import { useRouter } from "~/lib/navigation";
import { useToast } from "@/components/ui/use-toast";
import { PlusCircle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SelectedTestCasesDrawer } from "@/components/SelectedTestCasesDrawer";
import { DialogDescription } from "@radix-ui/react-dialog";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { updateTestRunForecast } from "~/services/testRunService";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { Combine } from "lucide-react";
import LoadingSpinner from "~/components/LoadingSpinner";
import LoadingSpinnerAlert from "~/components/LoadingSpinnerAlert";
import { v4 as uuidv4 } from "uuid";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import {
  getAssignmentsForRunCases,
  type GetAssignmentsResponse,
} from "~/app/actions/getAssignmentsForRunCases";
import { MagicSelectButton } from "@/components/runs/MagicSelectButton";

interface WorkflowOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}

interface ConfigurationOption {
  id: number;
  name: string;
}

// Define the form schemas at the top level
const BasicInfoFormSchema = z.object({
  name: z.string().min(2, {
    error: "Name must be at least 2 characters.",
  }),
  configIds: z.array(z.number()),
  milestoneId: z.number().nullable(),
  stateId: z.number().min(1, {
    error: "State is required.",
  }),
  note: z.any().nullable(),
  docs: z.any().nullable(),
  attachments: z.array(z.any()).optional(),
});

const BaseFormSchema = z.object({
  name: z.string().min(2, {
    error: "Name must be at least 2 characters.",
  }),
  configIds: z.array(z.number()),
  milestoneId: z.number().nullable(),
  stateId: z.number(),
  note: z.any().nullable(),
  docs: z.any().nullable(),
  attachments: z.array(z.any()).optional(),
  testCases: z.array(z.number()),
});

// Step 1: Basic Information Dialog
const BasicInfoDialog = React.memo(
  ({
    open,
    onClose,
    onNext,
    form,
    workflowsOptions,
    milestonesOptions,
    defaultWorkflow,
    configurationsOptions,
    selectedTags,
    setSelectedTags,
    selectedFiles,
    handleFileSelect,
    handleSelect,
    selectedAttachmentIndex,
    handleAttachmentClose,
    projectId,
    t,
    issueConfigId,
    linkedIssueIds,
    setLinkedIssueIds,
    canCreateTags = false,
  }: any) => {
    const tCommon = useTranslations("common");
    const parentMilestoneId = form.getValues("milestoneId");

    const basicInfoForm = useForm<z.infer<typeof BasicInfoFormSchema>>({
      resolver: zodResolver(BasicInfoFormSchema),
      defaultValues: {
        name: form.getValues("name"),
        configIds: form.getValues("configIds"),
        milestoneId: parentMilestoneId,
        stateId: defaultWorkflow?.id || form.getValues("stateId"),
        note: form.getValues("note"),
        docs: form.getValues("docs"),
        attachments: form.getValues("attachments"),
      },
      mode: "onChange",
    });

    useEffect(() => {
      basicInfoForm.setValue("milestoneId", parentMilestoneId);
    }, [basicInfoForm, parentMilestoneId]);

    useEffect(() => {
      if (defaultWorkflow) {
        basicInfoForm.setValue("stateId", defaultWorkflow.id);
      }
    }, [defaultWorkflow, basicInfoForm]);

    useEffect(() => {
      const mainFormMilestoneId = form.getValues("milestoneId");
      if (mainFormMilestoneId !== null && mainFormMilestoneId !== undefined) {
        basicInfoForm.setValue("milestoneId", mainFormMilestoneId);
        setTimeout(() => {
          basicInfoForm.trigger("milestoneId");
        }, 10);
      }
    }, [form, basicInfoForm]);

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
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
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
                        {tCommon("fields.name")}
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
                      } catch (e) {}
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
                            placeholder={tCommon("placeholders.description")}
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

                    const clearAllConfigurations = () => {
                      field.onChange([]);
                    };

                    return (
                      <FormItem>
                        <FormLabel className="flex justify-between items-center">
                          <div className="flex items-center">
                            {tCommon("fields.configurations")}
                            {selectedConfigs.length > 0 && (
                              <span className="ml-1 text-muted-foreground">
                                {"("}
                                {selectedConfigs.length}
                                {")"}
                              </span>
                            )}
                            <HelpPopover helpKey="testRun.configuration" />
                          </div>
                          {selectedConfigs.length > 0 && (
                            <span
                              onClick={clearAllConfigurations}
                              className="cursor-pointer text-sm text-muted-foreground hover:underline"
                            >
                              {tCommon("actions.clearAll")}
                            </span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <MultiAsyncCombobox<ConfigurationOption>
                            value={selectedConfigs}
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
                              <span className="flex items-center gap-1">
                                <Combine className="w-3 h-3" />
                                {config.name}
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
                      } catch (e) {}
                    }
                    return (
                      <FormItem>
                        <FormLabel className="flex items-center">
                          {tCommon("labels.docs")}
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
                          <SelectTrigger>
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
                              >
                                <div className="flex items-center gap-2">
                                  {option.icon && (
                                    <DynamicIcon
                                      name={option.icon as IconName}
                                      className="h-4 w-4"
                                      style={{ color: option.color }}
                                    />
                                  )}
                                  {option.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
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
                          <UploadAttachments onFileSelect={handleFileSelect} />
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
              <Button variant="outline" onClick={onClose}>
                {tCommon("actions.cancel")}
              </Button>
              <Button onClick={handleNextStep} data-testid="run-next-button">
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
      </DialogContent>
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
    onClose,
    onPrevious,
    onNext,
    selectedTestCases,
    setSelectedTestCases,
    t,
    tCommon,
    form,
    projectId,
    linkedIssueIds,
  }: any) => {
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

      fetchTestCases();
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
        fetchForecast();
      }
    }, [selectedTestCases, open]);

    // Map fetchedTestCases to the structure expected by SelectedTestCasesDrawer
    const mappedTestCasesForDrawer = useMemo(() => {
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
      <DialogContent className="max-w-[1200px] h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-0 pr-4">
          <DialogTitle>{t("selectCases")}</DialogTitle>
          <DialogDescription className="flex justify-between items-start text-muted-foreground">
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
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1">
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
        <div className="p-6 bg-background border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onPrevious}>
            {tCommon("actions.back")}
          </Button>
          <Button
            onClick={onNext}
            disabled={isLoadingForecast || isLoadingTestCasesForDrawer}
            data-testid="run-save-button"
          >
            {tCommon("actions.save")}
          </Button>
        </div>
      </DialogContent>
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
}

interface AddTestRunModalProps {
  defaultMilestoneId?: number;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialSelectedCaseIds: number[];
  onSelectedCasesChange: (cases: number[]) => void;
  duplicationPreset?: AddRunModalDuplicationPreset;
}

export default function AddTestRunModal({
  defaultMilestoneId,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialSelectedCaseIds,
  onSelectedCasesChange,
  duplicationPreset,
}: AddTestRunModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen;
  const [step, setStep] = useState(0);
  const [selectedCaseIds, setSelectedCaseIds] = useState<number[]>(
    initialSelectedCaseIds || []
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const { data: session } = useSession();
  const { projectId } = useParams();
  const numericProjectId = Number(projectId);
  const t = useTranslations("runs.add");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [creationProgress, setCreationProgress] = useState({
    current: 0,
    total: 0,
  });
  const router = useRouter();
  const { toast } = useToast();
  const [linkedIssueIds, setLinkedIssueIds] = useState<number[]>([]);

  const { mutateAsync: createTestRuns } = useCreateTestRuns();
  const { mutateAsync: createAttachments } = useCreateAttachments();
  const { data: configurations } = useFindManyConfigurations({
    where: { isDeleted: false, isEnabled: true },
    orderBy: { name: "asc" },
  });
  const { data: workflows } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "RUNS",
      projects: { some: { projectId: Number(projectId) } },
    },
    include: { icon: true, color: true },
    orderBy: { order: "asc" },
  });
  const { data: milestones } = useFindManyMilestones({
    where: {
      projectId: Number(projectId),
      isDeleted: false,
      isCompleted: false,
    },
    include: {
      milestoneType: { include: { icon: true } },
      children: { include: { milestoneType: { include: { icon: true } } } },
    },
  });
  const { data: projectAssignments } = useFindManyProjectAssignment({
    where: {
      projectId: Number(projectId),
      user: { isActive: true, isDeleted: false },
    },
    include: { user: { select: { id: true, name: true } } },
  });
  const { data: tags } = useFindManyTags({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });

  const defaultWorkflow = workflows?.find((workflow) => workflow.isDefault);
  const configurationsOptions: ConfigurationOption[] =
    configurations?.map((c) => ({ id: c.id, name: c.name })) || [];
  const workflowsOptions = useMemo(() => {
    return (
      workflows?.map((w) => ({
        value: w.id.toString(),
        label: w.name,
        icon: w.icon?.name,
        color: w.color?.value,
      })) || []
    );
  }, [workflows]);
  const milestonesOptions = (milestones || []).map((m: any) => ({
    value: m.id.toString(),
    label: m.name,
    milestoneType: m.milestoneType
      ? {
          icon: m.milestoneType.icon
            ? { name: m.milestoneType.icon.name as IconName }
            : undefined,
        }
      : undefined,
    parentId: m.parentId,
  }));
  const assignedToOptions =
    projectAssignments?.map((a) => ({
      value: a.user.id,
      label: a.user.name,
    })) || [];

  const mainDialogOnOpenChange = (newOpenState: boolean) => {
    const actualOpenerOrCloser = controlledOnOpenChange ?? setInternalOpen;

    if (!newOpenState) {
      // Dialog is closing, perform cleanup
      try {
        setStep(0);
        // It's important to call onSelectedCasesChange to update parent component if necessary
        if (typeof onSelectedCasesChange === "function") {
          onSelectedCasesChange(initialSelectedCaseIds || []); // Reset to initial or empty
        }
        setSelectedFiles([]);
        setLinkedIssueIds([]);
        setSelectedTags([]); // Reset tags

        // Reset form to initial/duplication preset state or default clean state
        // This ensures that if the dialog is re-opened, it's in a predictable state.
        const defaultName = duplicationPreset
          ? `${duplicationPreset.originalName} - ${tCommon("actions.duplicate")}`
          : "";
        const defaultConfigIds = duplicationPreset?.originalConfigId
          ? [duplicationPreset.originalConfigId]
          : [];
        const defaultMilestoneVal = duplicationPreset
          ? duplicationPreset.originalMilestoneId
          : defaultMilestoneId;
        const defaultStateIdVal = duplicationPreset
          ? duplicationPreset.originalStateId || defaultWorkflow?.id
          : defaultWorkflow?.id;
        const defaultNote = duplicationPreset
          ? duplicationPreset.originalNote
          : JSON.stringify(emptyEditorContent);
        const defaultDocs = duplicationPreset
          ? duplicationPreset.originalDocs
          : JSON.stringify(emptyEditorContent);

        form.reset({
          name: defaultName,
          configIds: defaultConfigIds,
          milestoneId: defaultMilestoneVal,
          stateId: defaultStateIdVal,
          note: defaultNote,
          docs: defaultDocs,
          attachments: [], // Always reset attachments on close
          testCases: initialSelectedCaseIds || [], // Reset test cases to initial state
        });

        setSelectedAttachmentIndex(null);
        setSelectedAttachments([]);
        // setSelectedCaseIds(initialSelectedCaseIds || []); // This might be redundant if parent controls via initialSelectedCaseIds
      } catch (error) {
        console.error(
          "Error during AddTestRunModal cleanup in mainDialogOnOpenChange:",
          error
        );
      }
      actualOpenerOrCloser(false); // Call the actual function to close the dialog
    } else {
      // Dialog is opening
      // The useEffect hook dependent on 'open' handles detailed form resets for new/duplication.
      // Ensure step is 0 for a fresh open.
      setStep(0);
      // Sync selectedCaseIds with initialSelectedCaseIds from props when opening
      setSelectedCaseIds(initialSelectedCaseIds || []);
      actualOpenerOrCloser(true); // Call the actual function to open the dialog
    }
  };

  const form = useForm<z.infer<typeof BaseFormSchema>>({
    resolver: zodResolver(BaseFormSchema),
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
    control,
    watch,
    reset,
    formState: { errors },
    setValue,
  } = form;

  // Merged useEffect for form initialization and reset
  useEffect(() => {
    if (open && duplicationPreset && defaultWorkflow) {
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
    } else if (open && !duplicationPreset && defaultWorkflow) {
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
      setLinkedIssueIds([]);
    }
    // This effect should run when the modal opens or when key dependencies for defaults change.
    // Explicitly not including `reset` in deps as it's stable, but form values depend on these.
  }, [
    open,
    duplicationPreset,
    defaultWorkflow,
    initialSelectedCaseIds,
    defaultMilestoneId,
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
  const { data: project } = useFindFirstProjects({
    where: { id: Number(projectId) },
  });
  const userName = session?.user?.name || "Unknown User";
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );

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
    return Promise.all(attachmentsPromises);
  };

  const handleConfirmSelection = (selectedIds: number[]) => {
    onSelectedCasesChange(selectedIds);
    setValue("testCases", selectedIds);
  };

  const handleNext = () => {
    if (step === 1) {
      setValue("testCases", selectedCaseIds); // Ensure selectedCaseIds from state is used
      handleSubmit(onSubmit)();
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

  async function onSubmit(data: z.infer<typeof BaseFormSchema>) {
    if (!session?.user?.id) {
      toast({
        variant: "destructive",
        title: tCommon("errors.notAuthenticated.title"),
        description: tCommon("errors.notAuthenticated.message"),
      });
      return;
    }
    setIsSubmitting(true);
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
            toast({
              variant: "destructive",
              title: tCommon("errors.failedToFetchAssignments.title"),
              description:
                response.error ||
                tCommon("errors.failedToFetchAssignments.message"),
            });
          }
        }
      }

      const testCasesCreateData = data.testCases.map((repoCaseId, index) => {
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
      });

      // Determine configs to create runs for
      const configsToCreate =
        data.configIds.length > 0 ? data.configIds : [null];

      // Generate a group ID if creating multiple runs
      const configurationGroupId = configsToCreate.length > 1 ? uuidv4() : null;

      const createdRuns: any[] = [];
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
          if (createdRuns.length === 1 && selectedFiles.length > 0) {
            await uploadFiles(newTestRun.id);
          }

          await updateTestRunForecast(newTestRun.id);
        }
      }

      const runsCreated = createdRuns.length;
      toast({
        title: t("success.title"),
        description:
          runsCreated > 1
            ? t("success.descriptionMultiple", {
                count: runsCreated,
                name: data.name,
              })
            : t("success.description", { name: data.name }),
      });
      onOpenChange(false);
      router.refresh();
    } catch (error: any) {
      console.error("Failed to create test run:", error);
      toast({
        variant: "destructive",
        title: t("errors.failedToCreate.title"),
        description: error.message || t("errors.failedToCreate.message"),
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

  return (
    <Dialog open={open} onOpenChange={mainDialogOnOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      {!trigger && (
        <DialogTrigger asChild>
          <Button type="button">
            <PlusCircle className="w-4" />
            <span className="hidden md:inline">{t("title")}</span>
          </Button>
        </DialogTrigger>
      )}
      {DialogContentComponent && open && (
        <DialogContentComponent {...dialogProps} />
      )}
    </Dialog>
  );
}
