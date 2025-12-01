"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  FileText,
  Search,
  Settings,
  Eye,
  Download,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Tag,
  SquarePen,
  ListChecks,
  Info,
} from "lucide-react";
import { SearchIssuesDialog } from "@/components/issues/search-issues-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import LoadingSpinnerAlert from "@/components/LoadingSpinnerAlert";
import { useForm, Controller, FormProvider } from "react-hook-form";
import FieldValueRenderer from "./[caseId]/FieldValueRenderer";
import {
  convertHtmlToTipTapJSON,
  convertTextToTipTapJSON,
  ensureTipTapJSON,
  serializeTipTapJSON,
} from "~/utils/tiptapConversion";
import {
  useFindFirstProjects,
  useFindManyTemplates,
  useFindManyRepositoryCases,
  useCreateRepositoryCases,
  useUpdateRepositoryCases,
  useUpsertIssue,
  useCreateCaseFieldValues,
  useCreateSteps,
  useFindFirstWorkflows,
  useUpsertTags,
  useCreateRepositoryCaseVersions,
  useCreateCaseFieldVersionValues,
} from "~/lib/hooks";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useIssueColors } from "~/hooks/useIssueColors";
import { ApplicationArea } from "@prisma/client";
import { useSession } from "next-auth/react";
import { emptyEditorContent } from "~/app/constants";
import { tiptapToHtml } from "~/utils/tiptapToHtml";

interface ExternalIssue {
  id: string;
  key?: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  externalId?: string;
  externalKey?: string;
  externalUrl?: string;
  externalStatus?: string;
  url?: string;
  isExternal: boolean;
}

interface DocumentRequirements {
  id: string;
  title: string;
  description: string;
  isDocument: true;
}

interface GeneratedTestCase {
  id: string;
  name: string;
  steps?: Array<{
    id?: number;
    step: any;
    expectedResult: any;
    order?: number;
    sharedStepGroupId?: number | null;
    sharedStepGroupName?: string | null;
    isShared?: boolean;
    sharedStepGroup?: { name?: string | null } | null;
    testCaseId?: number;
    isDeleted?: boolean;
  }>;
  fieldValues: Record<string, any>;
  automated: boolean;
  tags?: string[];
}

type LlmErrorType =
  | "overloaded"
  | "quota"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "network"
  | "generic";

interface LlmErrorState {
  type: LlmErrorType;
  title: string;
  message: string;
  detail?: string;
  suggestions: string[];
  raw?: string;
  timestamp: string;
}

interface GenerateTestCasesWizardProps {
  folderId: number;
  folderName?: string | null;
  onImportComplete?: () => void;
}

enum WizardStep {
  SELECT_ISSUE = 0,
  SELECT_TEMPLATE = 1,
  ADD_NOTES = 2,
  REVIEW_GENERATED = 3,
}

type StepStatus = "pending" | "active" | "completed";

interface WizardStepDefinition {
  id: WizardStep;
  label: string;
  icon: LucideIcon;
}

const stepTitles = [
  "generateTestCases.steps.selectIssue",
  "generateTestCases.steps.selectTemplate",
  "generateTestCases.steps.addNotes",
  "generateTestCases.steps.reviewGenerated",
];

export function GenerateTestCasesWizard({
  folderId,
  folderName,
  onImportComplete,
}: GenerateTestCasesWizardProps) {
  const t = useTranslations("repository");
  const tCommon = useTranslations("common");
  const params = useParams();
  const projectId = Number(params.projectId);
  const { data: session } = useSession();
  const { getPriorityStyle, getStatusStyle } = useIssueColors();

  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(WizardStep.SELECT_ISSUE);
  const [selectedIssue, setSelectedIssue] = useState<ExternalIssue | null>(
    null
  );
  const [sourceType, setSourceType] = useState<"issue" | "document">("issue");
  const [documentRequirements, setDocumentRequirements] =
    useState<DocumentRequirements | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null
  );
  const [userNotes, setUserNotes] = useState("");
  const [quantity, setQuantity] = useState<string>("several");
  const [autoGenerateTags, setAutoGenerateTags] = useState(true);
  const [generatedTestCases, setGeneratedTestCases] = useState<
    GeneratedTestCase[]
  >([]);
  const [selectedTestCases, setSelectedTestCases] = useState<Set<string>>(
    new Set()
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [hasActiveIntegrations, setHasActiveIntegrations] = useState(false);
  const [hasActiveLlm, setHasActiveLlm] = useState(false);
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<number>>(
    new Set()
  );
  const [llmError, setLlmError] = useState<LlmErrorState | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [editingTestCaseIds, setEditingTestCaseIds] = useState<Set<string>>(
    new Set()
  );
  const [showUnsavedEditsDialog, setShowUnsavedEditsDialog] = useState(false);
  const llmErrorTranslationKey = "generateTestCases.errors.llm";

  // Store refs to form submit handlers for all test cases in edit mode
  const formSubmitHandlersRef = useRef<Map<string, () => void>>(new Map());

  // Fetch project data
  const { data: project } = useFindFirstProjects({
    where: {
      id: projectId,
      isDeleted: false,
    },
    include: {
      repositories: true,
      projectIntegrations: {
        where: { isActive: true },
        include: {
          integration: true,
        },
      },
      projectLlmIntegrations: {
        where: { isActive: true },
        include: {
          llmIntegration: true,
        },
      },
    },
  });

  // Fetch templates
  const { data: templates } = useFindManyTemplates({
    where: {
      isDeleted: false,
      projects: {
        some: {
          projectId,
        },
      },
    },
    include: {
      caseFields: {
        select: {
          caseFieldId: true,
          templateId: true,
          order: true,
          caseField: {
            include: {
              fieldOptions: {
                include: {
                  fieldOption: { include: { icon: true, iconColor: true } },
                },
                orderBy: {
                  fieldOption: {
                    order: "asc",
                  },
                },
              },
              type: true,
            },
          },
        },
        orderBy: {
          order: "asc",
        },
      },
    },
    orderBy: {
      templateName: "asc",
    },
  });

  // Fetch existing test cases in current folder for context
  const { data: existingTestCases } = useFindManyRepositoryCases(
    {
      where: {
        projectId: projectId,
        folderId: { equals: folderId },
        isDeleted: false,
        isArchived: false,
      },
      select: {
        name: true,
        order: true,
        template: {
          select: {
            templateName: true,
          },
        },
        caseFieldValues: {
          select: {
            value: true,
            field: {
              select: {
                displayName: true,
                type: {
                  select: {
                    type: true,
                  },
                },
              },
            },
          },
        },
        steps: {
          select: {
            step: true,
            expectedResult: true,
            order: true,
          },
          orderBy: {
            order: "asc",
          },
        },
      },
      take: 50, // Limit for context
    },
    {
      enabled: open && folderId > 0,
    }
  );

  // Fetch the maximum order value separately for accurate ordering
  const { data: maxOrderData } = useFindManyRepositoryCases({
    where: {
      folderId: folderId,
      isDeleted: false,
      isArchived: false,
    },
    select: {
      order: true,
    },
    orderBy: {
      order: "desc",
    },
    take: 1,
  });

  // Fetch default workflow state for new test cases
  const { data: defaultWorkflow } = useFindFirstWorkflows({
    where: {
      projects: {
        some: {
          projectId: projectId,
        },
      },
      isDefault: true,
      isEnabled: true,
      isDeleted: false,
      scope: "CASES",
    },
    orderBy: {
      order: "asc",
    },
  });

  // Check permissions
  const { permissions } = useProjectPermissions(
    projectId,
    ApplicationArea.TestCaseRepository
  );
  const canAddEdit = permissions?.canAddEdit ?? false;

  // ZenStack hooks for creating entities
  const createRepositoryCase = useCreateRepositoryCases();
  const updateRepositoryCase = useUpdateRepositoryCases();
  const upsertIssue = useUpsertIssue();
  const createCaseFieldValue = useCreateCaseFieldValues();
  const createStep = useCreateSteps();
  const upsertTag = useUpsertTags();
  const createRepositoryCaseVersion = useCreateRepositoryCaseVersions();
  const createCaseFieldVersionValue = useCreateCaseFieldVersionValues();

  useEffect(() => {
    if (project) {
      const hasIntegrations = project.projectIntegrations.length > 0;
      setHasActiveIntegrations(hasIntegrations);
      setHasActiveLlm(project.projectLlmIntegrations.length > 0);

      // If no external integrations, default to document source type
      if (!hasIntegrations) {
        setSourceType("document");
      }
    }
  }, [project]);

  useEffect(() => {
    if (templates && templates.length > 0) {
      const defaultTemplate =
        templates.find((t) => t.isDefault) || templates[0];
      setSelectedTemplateId(defaultTemplate.id);
    }
  }, [templates]);

  useEffect(() => {
    if (selectedTemplateId && templates) {
      const template = templates.find((t) => t.id === selectedTemplateId);
      if (template) {
        // Initialize with all field IDs selected by default
        const allFieldIds = new Set(
          template.caseFields.map((cf) => cf.caseFieldId)
        );
        setSelectedFieldIds(allFieldIds);
      }
    }
  }, [selectedTemplateId, templates]);

  const toggleFieldSelection = (fieldId: number, isRequired: boolean) => {
    if (isRequired) {
      // Required fields cannot be deselected
      return;
    }

    setSelectedFieldIds((prev) => {
      const newSelection = new Set(prev);
      if (newSelection.has(fieldId)) {
        newSelection.delete(fieldId);
      } else {
        newSelection.add(fieldId);
      }
      return newSelection;
    });
  };

  const selectAllFields = () => {
    if (selectedTemplateId && templates) {
      const template = templates.find((t) => t.id === selectedTemplateId);
      if (template) {
        const allFieldIds = new Set(
          template.caseFields.map((cf) => cf.caseFieldId)
        );
        setSelectedFieldIds(allFieldIds);
      }
    }
  };

  const deselectOptionalFields = () => {
    if (selectedTemplateId && templates) {
      const template = templates.find((t) => t.id === selectedTemplateId);
      if (template) {
        // Keep only required fields
        const requiredFieldIds = new Set(
          template.caseFields
            .filter((cf) => cf.caseField.isRequired)
            .map((cf) => cf.caseFieldId)
        );
        setSelectedFieldIds(requiredFieldIds);
      }
    }
  };

  // Define wizard steps with icons
  const wizardSteps = useMemo<WizardStepDefinition[]>(
    () => [
      {
        id: WizardStep.SELECT_ISSUE,
        label: t(stepTitles[0] as any),
        icon: Search,
      },
      {
        id: WizardStep.SELECT_TEMPLATE,
        label: t(stepTitles[1] as any),
        icon: Settings,
      },
      {
        id: WizardStep.ADD_NOTES,
        label: t(stepTitles[2] as any),
        icon: FileText,
      },
      {
        id: WizardStep.REVIEW_GENERATED,
        label: t(stepTitles[3] as any),
        icon: ListChecks,
      },
    ],
    [t]
  );

  // Determine which steps are unlocked based on validation
  const maxUnlockedStep = useMemo<WizardStep>(() => {
    // Check if step 1 is valid (source selected)
    const hasSource =
      sourceType === "issue" ? selectedIssue : documentRequirements;

    if (!hasSource) {
      // Step 1 is not complete, so only step 1 is accessible
      return WizardStep.SELECT_ISSUE;
    }

    // Step 1 is complete, so step 2 is now accessible
    // If on step 1, allow navigation to step 2
    if (currentStep === WizardStep.SELECT_ISSUE) {
      return WizardStep.SELECT_TEMPLATE;
    }

    // Check if step 2 is valid (template selected)
    if (!selectedTemplateId) {
      // Step 2 is not complete, so can't go beyond step 2
      return WizardStep.SELECT_TEMPLATE;
    }

    // Step 2 is complete, so step 3 is now accessible
    if (currentStep === WizardStep.SELECT_TEMPLATE) {
      return WizardStep.ADD_NOTES;
    }

    // Step 3 (notes) is always valid (optional)
    // If on step 3, allow navigation to step 4 only after generation
    if (currentStep === WizardStep.ADD_NOTES) {
      // Can't navigate to step 4 until test cases are generated
      return WizardStep.ADD_NOTES;
    }

    // Step 4: Unlocked only if test cases have been generated
    if (generatedTestCases.length > 0) {
      return WizardStep.REVIEW_GENERATED;
    }

    // Fallback
    return WizardStep.ADD_NOTES;
  }, [
    currentStep,
    sourceType,
    selectedIssue,
    documentRequirements,
    selectedTemplateId,
    generatedTestCases.length,
  ]);

  const stepStatusFor = useCallback(
    (step: WizardStep): StepStatus => {
      if (step === currentStep) {
        return "active";
      }
      if (step < maxUnlockedStep) {
        return "completed";
      }
      return "pending";
    },
    [currentStep, maxUnlockedStep]
  );

  const handleStepSelect = useCallback(
    (step: WizardStep) => {
      // Prevent navigation during import
      if (isImporting) {
        return;
      }
      if (step <= maxUnlockedStep) {
        setCurrentStep(step);
      }
    },
    [maxUnlockedStep, isImporting]
  );

  const goNext = useCallback(() => {
    setCurrentStep((previous) => {
      if (previous >= maxUnlockedStep) {
        return previous;
      }
      return Math.min(previous + 1, maxUnlockedStep) as WizardStep;
    });
  }, [maxUnlockedStep]);

  const goPrev = useCallback(() => {
    setCurrentStep((previous) => {
      if (previous > WizardStep.SELECT_ISSUE) {
        return (previous - 1) as WizardStep;
      }
      return previous;
    });
  }, []);

  const handleBack = useCallback(() => {
    goPrev();
  }, [goPrev]);

  const handleNext = useCallback(async () => {
    if (currentStep === WizardStep.ADD_NOTES) {
      // Generate test cases when moving from notes step
      await generateTestCases();
    } else {
      goNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, goNext]); // generateTestCases is intentionally not included as it's not memoized

  const resetWizard = () => {
    setCurrentStep(WizardStep.SELECT_ISSUE);
    setSelectedIssue(null);
    setSourceType("issue");
    setDocumentRequirements(null);
    setSelectedTemplateId(
      templates?.find((t) => t.isDefault)?.id || templates?.[0]?.id || null
    );
    setSelectedFieldIds(new Set());
    setUserNotes("");
    setQuantity("several");
    setGeneratedTestCases([]);
    setSelectedTestCases(new Set());
    setIsGenerating(false);
    setIsImporting(false);
    setLlmError(null);
    setShowErrorDetails(false);
  };

  // Helper function to get display name for integration provider
  const getProviderDisplayName = (provider: string | undefined): string => {
    if (!provider) return "External System";

    switch (provider) {
      case "JIRA":
        return "Jira";
      case "GITHUB":
        return "GitHub";
      case "AZURE_DEVOPS":
        return "Azure DevOps";
      case "SIMPLE_URL":
        return "External System";
      default:
        return "External System";
    }
  };

  const generateTestCases = async () => {
    const hasSource =
      sourceType === "issue" ? selectedIssue : documentRequirements;

    // Enhanced validation with specific error messages
    if (!hasActiveLlm) {
      toast.error(
        "No AI model is configured for this project. Please configure an AI model in project settings."
      );
      return;
    }

    if (!hasSource) {
      if (sourceType === "issue") {
        toast.error("Please select an issue to generate test cases from.");
      } else {
        toast.error("Please provide requirements document details.");
      }
      return;
    }

    if (!selectedTemplateId) {
      toast.error("Please select a template for the test cases.");
      return;
    }

    if (selectedFieldIds.size === 0) {
      toast.error("Please select at least one field to generate content for.");
      return;
    }

    setLlmError(null);
    setShowErrorDetails(false);
    setIsGenerating(true);
    try {
      const template = templates?.find((t) => t.id === selectedTemplateId);

      let issueData;
      if (sourceType === "issue" && selectedIssue) {
        // Get issue details including comments for better context
        const issueDetails = await fetchIssueDetails(selectedIssue);
        issueData = {
          key: selectedIssue.key || selectedIssue.externalKey,
          title: selectedIssue.title,
          description: issueDetails?.description || selectedIssue.description,
          status: selectedIssue.status || selectedIssue.externalStatus,
          priority: selectedIssue.priority,
          comments: issueDetails?.comments || [],
        };
      } else if (sourceType === "document" && documentRequirements) {
        issueData = {
          key: documentRequirements.id,
          title: documentRequirements.title,
          description: documentRequirements.description,
          status: "Requirements Document",
          comments: [],
        };
      } else {
        throw new Error("Invalid source configuration");
      }

      const response = await fetch("/api/llm/generate-test-cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          issue: issueData,
          template: {
            id: template?.id,
            name: template?.templateName,
            fields: template?.caseFields
              .filter((cf) => selectedFieldIds.has(cf.caseFieldId))
              .sort((a, b) => a.order - b.order)
              .map((cf) => ({
                id: cf.caseField.id,
                name: cf.caseField.displayName,
                type: cf.caseField.type.type,
                required: cf.caseField.isRequired,
                // Only include options for fields that actually have options (Dropdown, Multi-Select)
                options:
                  cf.caseField.fieldOptions &&
                  cf.caseField.fieldOptions.length > 0
                    ? cf.caseField.fieldOptions.map((fo) => fo.fieldOption.name)
                    : undefined,
              })),
          },
          context: {
            userNotes,
            existingTestCases:
              existingTestCases?.map((tc) => {
                // Extract text from the first text/long text field for context
                // Helper to extract plain text from TipTap JSON
                const extractPlainText = (value: any): string => {
                  if (!value) return "";
                  if (typeof value === "string") {
                    // Try to parse as TipTap JSON
                    try {
                      const parsed = JSON.parse(value);
                      if (parsed?.type === "doc" && parsed?.content) {
                        return extractPlainText(parsed);
                      }
                    } catch {
                      // Not JSON, return as-is
                      return value;
                    }
                    return value;
                  }
                  if (typeof value === "object" && value?.content) {
                    // TipTap JSON structure - recursively extract text
                    return value.content
                      .map((node: any) => {
                        if (node.type === "text") return node.text || "";
                        if (node.content) return extractPlainText(node);
                        return "";
                      })
                      .join(" ")
                      .trim();
                  }
                  return "";
                };

                // Find first text field with content (Text Long or Text String types)
                const textField = tc.caseFieldValues?.find((cfv: any) => {
                  const fieldType = cfv.field?.type?.type?.toLowerCase();
                  return (
                    (fieldType === "text long" || fieldType === "text string") &&
                    cfv.value
                  );
                });

                const description = textField?.value
                  ? extractPlainText(textField.value).substring(0, 200)
                  : undefined;

                return {
                  name: tc.name,
                  template: tc.template?.templateName,
                  description,
                  steps:
                    tc.steps && tc.steps.length > 0
                      ? tc.steps.map((s: any) => ({
                          step: extractPlainText(s.step),
                          expectedResult: extractPlainText(s.expectedResult),
                        }))
                      : undefined,
                };
              }) || [],
            folderContext: folderId,
          },
          quantity,
          autoGenerateTags,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        let errorMessage = "Failed to generate test cases";
        let parsedError: any = null;

        try {
          parsedError = JSON.parse(errorData);
          if (parsedError.error) {
            errorMessage = parsedError.error;
          } else if (parsedError.message) {
            errorMessage = parsedError.message;
          }
        } catch {
          // Check if response is HTML (network/routing issue)
          if (
            errorData.includes("<!DOCTYPE html>") ||
            errorData.includes("<html>") ||
            errorData.includes("Synology")
          ) {
            errorMessage =
              "Network routing or server configuration issue - received HTML error page instead of API response";
          } else if (errorData && errorData.trim().length > 0) {
            errorMessage = errorData.trim();
          } else {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }
        }

        // Create error with enhanced data if available
        const errorObj = {
          message: errorMessage,
          ...(parsedError && { enhancedError: parsedError }),
        };
        throw new Error(JSON.stringify(errorObj));
      }

      const result = await response.json();

      // Convert option names to option IDs for dropdown/multiselect fields
      const testCasesWithConvertedValues = (result.testCases || []).map(
        (tc: GeneratedTestCase) => {
          const convertedFieldValues: Record<string, any> = {
            ...tc.fieldValues,
          };

          if (!template) return tc;

          template.caseFields.forEach((cf: any) => {
            const fieldDisplayName = cf.caseField.displayName;
            const fieldType = cf.caseField.type.type;
            const fieldValue = convertedFieldValues[fieldDisplayName];

            if (!fieldValue) return;

            if (fieldType === "Dropdown" && typeof fieldValue === "string") {
              // Convert option name to option ID
              const option = cf.caseField.fieldOptions?.find(
                (fo: any) => fo.fieldOption.name === fieldValue
              );
              if (option) {
                convertedFieldValues[fieldDisplayName] = option.fieldOption.id;
              }
            } else if (
              fieldType === "Multi-Select" &&
              Array.isArray(fieldValue)
            ) {
              // Convert array of option names to array of option IDs
              convertedFieldValues[fieldDisplayName] = fieldValue
                .map((name: string) => {
                  const option = cf.caseField.fieldOptions?.find(
                    (fo: any) => fo.fieldOption.name === name
                  );
                  return option?.fieldOption.id;
                })
                .filter((id: number | undefined) => id !== undefined);
            }
          });

          return {
            ...tc,
            fieldValues: convertedFieldValues,
          };
        }
      );

      setGeneratedTestCases(testCasesWithConvertedValues);
      setSelectedTestCases(
        new Set(
          testCasesWithConvertedValues.map((tc: GeneratedTestCase) => tc.id)
        )
      );
      setCurrentStep(WizardStep.REVIEW_GENERATED);
    } catch (error) {
      console.error("Error generating test cases:", error);

      let parsedErrorPayload: any = null;
      try {
        if (error instanceof Error && error.message.startsWith("{")) {
          parsedErrorPayload = JSON.parse(error.message);
        }
      } catch {
        // ignore JSON parse failures and fall back to default messaging
      }

      const enhancedError =
        parsedErrorPayload?.enhancedError ?? parsedErrorPayload ?? null;

      const providerDetail =
        (enhancedError && typeof enhancedError.details === "string"
          ? enhancedError.details
          : undefined) ||
        (enhancedError && typeof enhancedError.message === "string"
          ? enhancedError.message
          : undefined) ||
        "";

      const normalizedMessage = [
        providerDetail,
        typeof enhancedError?.error === "string" ? enhancedError.error : "",
        error instanceof Error ? error.message : String(error),
      ]
        .join(" ")
        .toLowerCase();

      const contains = (value: string) =>
        value ? normalizedMessage.includes(value.toLowerCase()) : false;

      let errorType: LlmErrorType = "generic";

      if (contains("overload") || contains("busy") || contains("capacity")) {
        errorType = "overloaded";
      } else if (
        contains("quota") ||
        contains("rate limit") ||
        (contains("limit") && !contains("unlimited"))
      ) {
        errorType = "quota";
      } else if (
        contains("timeout") ||
        contains("timed out") ||
        contains("504")
      ) {
        errorType = "timeout";
      } else if (
        contains("401") ||
        contains("unauthorized") ||
        contains("invalid api key") ||
        contains("invalid key")
      ) {
        errorType = "unauthorized";
      } else if (
        contains("403") ||
        contains("forbidden") ||
        contains("permission") ||
        contains("insufficient")
      ) {
        errorType = "forbidden";
      } else if (
        contains("network") ||
        contains("fetch") ||
        contains("dns") ||
        contains("econnreset") ||
        contains("eai_again") ||
        contains("socket")
      ) {
        errorType = "network";
      }

      const suggestionKeyMap: Record<LlmErrorType, string[]> = {
        overloaded: ["retryLater", "reduceRequest", "checkStatus"],
        quota: ["retryLater", "reviewConfiguration", "contactAdmin"],
        timeout: ["retryLater", "checkStatus", "contactAdmin"],
        unauthorized: ["reviewConfiguration", "contactAdmin", "checkStatus"],
        forbidden: ["reviewConfiguration", "contactAdmin", "checkStatus"],
        network: ["checkNetwork", "retryLater", "contactAdmin"],
        generic: ["retryLater", "contactAdmin", "checkStatus"],
      };

      const providerSuggestions =
        Array.isArray(enhancedError?.suggestions) &&
        enhancedError?.suggestions.length > 0
          ? enhancedError.suggestions
              .slice(0, 4)
              .filter(
                (item: unknown): item is string => typeof item === "string"
              )
          : [];

      const baseKey = llmErrorTranslationKey;

      let title = t(`${baseKey}.genericTitle` as any);
      let message = t(`${baseKey}.genericMessage` as any);

      switch (errorType) {
        case "overloaded":
          title = t(`${baseKey}.overloaded.title` as any);
          message = t(`${baseKey}.overloaded.message` as any);
          break;
        case "quota":
          title = t(`${baseKey}.quota.title` as any);
          message = t(`${baseKey}.quota.message` as any);
          break;
        case "timeout":
          title = t(`${baseKey}.timeout.title` as any);
          message = t(`${baseKey}.timeout.message` as any);
          break;
        case "unauthorized":
          title = t(`${baseKey}.unauthorized.title` as any);
          message = t(`${baseKey}.unauthorized.message` as any);
          break;
        case "forbidden":
          title = t(`${baseKey}.forbidden.title` as any);
          message = t(`${baseKey}.forbidden.message` as any);
          break;
        case "network":
          title = t(`${baseKey}.network.title` as any);
          message = t(`${baseKey}.network.message` as any);
          break;
        default:
          break;
      }

      const detailParts: string[] = [];

      if (providerDetail) {
        detailParts.push(providerDetail);
      }

      if (enhancedError?.context) {
        const ctx = enhancedError.context;
        const tagsLabel = ctx.autoTagsEnabled
          ? t(`${baseKey}.contextTagsOn` as any)
          : t(`${baseKey}.contextTagsOff` as any);

        detailParts.push(
          (t as any)(`${baseKey}.contextSummary`, {
            quantity: ctx.quantity ?? quantity,
            fields: ctx.fieldsCount ?? selectedFieldIds.size,
            tags: tagsLabel,
          })
        );
      }

      const detail = detailParts.join("\n\n");

      const suggestionKeys = suggestionKeyMap[errorType];
      const suggestions =
        providerSuggestions.length > 0
          ? providerSuggestions
          : suggestionKeys.map((key) =>
              t(`${baseKey}.suggestions.${key}` as any)
            );

      const rawDetailSources: string[] = [];

      if (enhancedError) {
        try {
          rawDetailSources.push(JSON.stringify(enhancedError, null, 2));
        } catch {
          // ignore serialization failure
        }
      }

      if (error instanceof Error) {
        if (typeof error.stack === "string") {
          rawDetailSources.push(error.stack);
        } else if (error.message) {
          rawDetailSources.push(error.message);
        }
      } else {
        rawDetailSources.push(String(error));
      }

      const raw =
        rawDetailSources.length > 0 ? rawDetailSources.join("\n\n") : undefined;

      const timestamp = new Date().toISOString();

      const nextErrorState: LlmErrorState = {
        type: errorType,
        title,
        message,
        detail: detail || undefined,
        suggestions,
        raw,
        timestamp,
      };

      setLlmError(nextErrorState);

      toast.error(title, {
        description: message,
        duration: 8000,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRetryGeneration = () => {
    void generateTestCases();
  };

  const handleCopyErrorDetails = async () => {
    if (
      !llmError?.raw ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      return;
    }

    try {
      await navigator.clipboard.writeText(llmError.raw);
      toast.success(t(`${llmErrorTranslationKey}.detailsCopied` as any));
    } catch (copyError) {
      console.error("Failed to copy error details:", copyError);
      toast.error(tCommon("errors.somethingWentWrong"));
    }
  };

  const handleDismissError = () => {
    setLlmError(null);
    setShowErrorDetails(false);
  };

  const fetchIssueDetails = async (issue: ExternalIssue) => {
    if (!project?.projectIntegrations?.[0]) return null;

    try {
      const response = await fetch(
        `/api/integrations/issue-details?projectId=${projectId}&issueKey=${encodeURIComponent(issue.key || issue.externalKey || String(issue.id))}`
      );
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error("Failed to fetch issue details:", error);
    }
    return null;
  };

  const importSelectedTestCases = async () => {
    if (selectedTestCases.size === 0) {
      toast.error("Please select at least one test case to import.");
      return;
    }

    if (!selectedTemplateId) {
      toast.error(
        "Template selection is required. Please go back and select a template."
      );
      return;
    }

    if (!project?.repositories?.[0]?.id) {
      toast.error(
        "Project repository not found. Please contact your administrator."
      );
      return;
    }

    if (!defaultWorkflow?.id) {
      toast.error(
        "Project workflow not configured. Please verify project settings."
      );
      return;
    }

    if (!session?.user?.id) {
      toast.error(
        "Authentication error. Please refresh the page and try again."
      );
      return;
    }

    setIsImporting(true);
    setImportProgress(0);
    try {
      const testCasesToImport = generatedTestCases.filter((tc) =>
        selectedTestCases.has(tc.id)
      );

      // Get the selected template for field mapping
      const selectedTemplate = templates?.find(
        (t) => t.id === selectedTemplateId
      );
      if (!selectedTemplate) {
        throw new Error("Selected template not found");
      }

      // Get the highest order for new cases
      let maxOrder = 0;

      if (maxOrderData && maxOrderData.length > 0) {
        maxOrder = maxOrderData[0].order || 0;
      } else if (existingTestCases && existingTestCases.length > 0) {
        // Fallback to the limited dataset if maxOrderData is not available
        maxOrder = Math.max(...existingTestCases.map((c: any) => c.order));
      }

      let importedCount = 0;
      let sharedIssue = null;

      // Create or find the issue once before importing test cases (if needed)
      if (sourceType === "issue" && selectedIssue && session?.user?.id) {
        const issueKey = selectedIssue.key || selectedIssue.externalKey;
        const integrationId = project?.projectIntegrations?.[0]?.integrationId;

        if (!integrationId) {
          console.error("No integration found for project");
          // Skip issue creation but continue with import
        } else {
          // Use upsert to find existing or create new issue atomically
          try {
            sharedIssue = await upsertIssue.mutateAsync({
              where: {
                externalId_integrationId: {
                  externalId: selectedIssue.id || issueKey || "",
                  integrationId: integrationId,
                },
              },
              create: {
                name: issueKey || selectedIssue.title,
                title: selectedIssue.title,
                description: "External issue linked from test case generation",
                externalKey: issueKey,
                externalId: selectedIssue.id || issueKey,
                externalUrl: selectedIssue.url || selectedIssue.externalUrl,
                projectId: projectId,
                integrationId: integrationId,
                createdById: session.user.id,
              },
              update: {
                // Update fields that might have changed
                title: selectedIssue.title,
                externalKey: issueKey,
                externalUrl: selectedIssue.url || selectedIssue.externalUrl,
              },
            });
          } catch (error) {
            console.error("Error finding or creating issue:", error);
          }
        }
      }

      for (const testCase of testCasesToImport) {
        try {
          // Get proper repository ID and workflow state
          const repositoryId = project?.repositories?.[0]?.id;
          const stateId = defaultWorkflow?.id;

          if (!repositoryId || !stateId || !session?.user?.id) {
            console.error(
              `Missing required data - repositoryId: ${repositoryId}, stateId: ${stateId}, userId: ${session?.user?.id}`
            );
            continue;
          }

          // Create the repository case
          let newCase;
          const calculatedOrder = maxOrder + importedCount + 1;

          const caseData = {
            projectId,
            repositoryId,
            folderId,
            templateId: selectedTemplateId,
            name: testCase.name.slice(0, 255), // Ensure name doesn't exceed limit
            source: "API" as const, // Generated via API
            stateId,
            order: calculatedOrder,
            creatorId: session.user.id,
            automated: false,
            currentVersion: 1,
          };

          try {
            newCase = await createRepositoryCase.mutateAsync({
              data: caseData,
            });
          } catch (error) {
            console.error(
              `Failed to create repository case for "${testCase.name}":`,
              error
            );
            console.error("Error details:", {
              message: error instanceof Error ? error.message : String(error),
              status: (error as any)?.status,
              details: (error as any)?.info,
            });

            // Show specific error to user for case creation failures
            let caseErrorMessage = `Failed to create test case: ${testCase.name}`;
            if (error instanceof Error) {
              if (
                error.message.includes("unique constraint") ||
                error.message.includes("duplicate")
              ) {
                caseErrorMessage = `Test case "${testCase.name}" already exists in this folder.`;
              } else if (
                error.message.includes("template") ||
                error.message.includes("templateId")
              ) {
                caseErrorMessage = `Invalid template configuration for test case "${testCase.name}".`;
              } else if (
                error.message.includes("name") &&
                error.message.includes("length")
              ) {
                caseErrorMessage = `Test case name "${testCase.name}" is too long. Please use a shorter name.`;
              } else if (error.message.trim().length > 5) {
                caseErrorMessage = `Failed to create "${testCase.name}": ${error.message}`;
              }
            }
            toast.error(caseErrorMessage);
            continue;
          }

          if (!newCase) {
            console.error(
              `Failed to create repository case for: ${testCase.name}`
            );
            continue;
          }

          // Create repository case version for version 1
          let newCaseVersion;
          try {
            // Prepare steps data for version - convert to proper TipTap editor format
            const resolvedStepsForVersion =
              testCase.steps?.map((step) => {
                // Convert step text to TipTap format
                const stepContent =
                  typeof step.step === "string"
                    ? {
                        type: "doc",
                        content: [
                          {
                            type: "paragraph",
                            content: [{ type: "text", text: step.step }],
                          },
                        ],
                      }
                    : step.step || emptyEditorContent;

                // Convert expected result to TipTap format
                const expectedResultContent =
                  typeof step.expectedResult === "string"
                    ? {
                        type: "doc",
                        content: [
                          {
                            type: "paragraph",
                            content: [
                              { type: "text", text: step.expectedResult },
                            ],
                          },
                        ],
                      }
                    : step.expectedResult || emptyEditorContent;

                return {
                  step: stepContent,
                  expectedResult: expectedResultContent,
                };
              }) || [];

            // Prepare issues data for version if linked to an external issue
            const issuesDataForVersion = sharedIssue
              ? [
                  {
                    id: sharedIssue.id,
                    name: sharedIssue.name,
                    externalId: sharedIssue.externalId,
                  },
                ]
              : [];

            // Prepare tags data for version
            const tagNamesForVersion =
              autoGenerateTags && testCase.tags ? testCase.tags : [];

            newCaseVersion = await createRepositoryCaseVersion.mutateAsync({
              data: {
                repositoryCase: { connect: { id: newCase.id } },
                project: { connect: { id: projectId } },
                staticProjectName: project?.name || "Unknown Project",
                staticProjectId: projectId,
                repositoryId: project?.repositories?.[0]?.id || 0,
                folderId: folderId,
                folderName: "Generated", // Use a default folder name since it's required
                templateId: selectedTemplateId,
                templateName: selectedTemplate.templateName,
                name: testCase.name.slice(0, 255),
                stateId: defaultWorkflow.id,
                stateName: defaultWorkflow.name || "Unknown State",
                estimate: 0, // AI generated cases don't have duration estimates by default
                order: calculatedOrder,
                createdAt: new Date(),
                creatorId: session.user.id,
                creatorName: session.user.name || "Unknown User",
                automated: false,
                isArchived: false,
                isDeleted: false,
                version: 1,
                steps: resolvedStepsForVersion,
                attachments: [], // No attachments for AI generated cases
                tags: tagNamesForVersion,
                issues: issuesDataForVersion,
              },
            });

            if (!newCaseVersion) {
              throw new Error("Failed to create case version");
            }
          } catch (error) {
            console.error(
              `Error creating repository case version for ${testCase.name}:`,
              error
            );
            // Continue with import even if version creation fails
          }

          // Create field values for the test case
          // Filter out Steps field since it's handled separately via createStep calls
          for (const [fieldName, fieldValue] of Object.entries(
            testCase.fieldValues
          )) {
            // Skip Steps field - it's handled separately via createStep calls above
            if (
              fieldName === "Steps" ||
              fieldName.toLowerCase().includes("steps")
            ) {
              continue;
            }

            const templateField = selectedTemplate.caseFields.find(
              (cf) => cf.caseField.displayName === fieldName
            );

            if (templateField && fieldValue != null) {
              try {
                // Process the field value based on field type
                let processedValue = fieldValue;
                const fieldType = templateField.caseField.type.type;

                switch (fieldType) {
                  case "Text Long":
                    // Convert string to TipTap JSON format if it's a string
                    if (typeof fieldValue === "string") {
                      processedValue = JSON.stringify(
                        convertTextToTipTapJSON(fieldValue)
                      );
                    } else {
                      processedValue = JSON.stringify(fieldValue);
                    }
                    break;

                  case "Dropdown":
                  case "Multi-Select":
                    // Try to map option names to IDs
                    if (Array.isArray(fieldValue)) {
                      processedValue = fieldValue.map((optionName: any) => {
                        const option =
                          templateField.caseField.fieldOptions?.find(
                            (fo: any) => fo.fieldOption.name === optionName
                          );
                        return option ? option.fieldOption.id : optionName;
                      });
                    } else if (typeof fieldValue === "string") {
                      const option = templateField.caseField.fieldOptions?.find(
                        (fo: any) => fo.fieldOption.name === fieldValue
                      );
                      processedValue = option
                        ? option.fieldOption.id
                        : fieldValue;
                    }
                    break;

                  case "Checkbox":
                    processedValue = Boolean(fieldValue);
                    break;

                  case "Integer":
                    processedValue = parseInt(fieldValue as string) || 0;
                    break;

                  case "Number":
                    processedValue = parseFloat(fieldValue as string) || 0;
                    break;

                  default:
                    // For other types, use as-is
                    processedValue = fieldValue;
                    break;
                }

                await createCaseFieldValue.mutateAsync({
                  data: {
                    testCaseId: newCase.id,
                    fieldId: templateField.caseFieldId,
                    value: processedValue,
                  },
                });
              } catch (error) {
                console.error(
                  `Error creating field value for ${fieldName}:`,
                  error
                );
              }
            }
          }

          // Create field version values for the repository case version
          // Filter out Steps field since it's handled separately in the version JSON
          if (newCaseVersion) {
            for (const [fieldName, fieldValue] of Object.entries(
              testCase.fieldValues
            )) {
              // Skip Steps field - it's handled in the version JSON above
              if (
                fieldName === "Steps" ||
                fieldName.toLowerCase().includes("steps")
              ) {
                continue;
              }

              const templateField = selectedTemplate.caseFields.find(
                (cf) => cf.caseField.displayName === fieldName
              );

              if (templateField && fieldValue != null) {
                try {
                  // Process the field value based on field type (same logic as above)
                  let processedValue = fieldValue;
                  const fieldType = templateField.caseField.type.type;

                  switch (fieldType) {
                    case "Text Long":
                      if (typeof fieldValue === "string") {
                        processedValue = JSON.stringify(
                          convertTextToTipTapJSON(fieldValue)
                        );
                      } else {
                        processedValue = JSON.stringify(fieldValue);
                      }
                      break;

                    case "Dropdown":
                    case "Multi-Select":
                      if (Array.isArray(fieldValue)) {
                        processedValue = fieldValue.map((optionName: any) => {
                          const option =
                            templateField.caseField.fieldOptions?.find(
                              (fo: any) => fo.fieldOption.name === optionName
                            );
                          return option ? option.fieldOption.id : optionName;
                        });
                      } else if (typeof fieldValue === "string") {
                        const option =
                          templateField.caseField.fieldOptions?.find(
                            (fo: any) => fo.fieldOption.name === fieldValue
                          );
                        processedValue = option
                          ? option.fieldOption.id
                          : fieldValue;
                      }
                      break;

                    case "Checkbox":
                      processedValue = Boolean(fieldValue);
                      break;

                    case "Integer":
                      processedValue = parseInt(fieldValue as string) || 0;
                      break;

                    case "Number":
                      processedValue = parseFloat(fieldValue as string) || 0;
                      break;

                    default:
                      processedValue = fieldValue;
                      break;
                  }

                  await createCaseFieldVersionValue.mutateAsync({
                    data: {
                      version: { connect: { id: newCaseVersion.id } },
                      field: fieldName,
                      value: processedValue,
                    },
                  });
                } catch (error) {
                  console.error(
                    `Error creating field version value for ${fieldName}:`,
                    error
                  );
                }
              }
            }
          }

          // Create steps if provided
          if (testCase.steps && Array.isArray(testCase.steps)) {
            for (
              let stepIndex = 0;
              stepIndex < testCase.steps.length;
              stepIndex++
            ) {
              const step = testCase.steps[stepIndex];
              try {
                // Convert step text to TipTap JSON format
                const stepContent =
                  typeof step.step === "string"
                    ? convertTextToTipTapJSON(step.step)
                    : step.step || emptyEditorContent;

                // Convert expected result to TipTap JSON format
                const expectedResultContent =
                  typeof step.expectedResult === "string"
                    ? convertTextToTipTapJSON(step.expectedResult)
                    : step.expectedResult || emptyEditorContent;

                await createStep.mutateAsync({
                  data: {
                    testCaseId: newCase.id,
                    step: stepContent,
                    expectedResult: expectedResultContent,
                    order: stepIndex,
                  },
                });
              } catch (error) {
                console.error(`Error creating step ${stepIndex + 1}:`, error);
              }
            }
          }

          // Link to shared issue if available
          if (sharedIssue) {
            try {
              await updateRepositoryCase.mutateAsync({
                where: { id: newCase.id },
                data: {
                  order: calculatedOrder, // Explicitly preserve the order
                  issues: {
                    connect: [{ id: sharedIssue.id }],
                  },
                },
              });
            } catch (error) {
              console.error(
                `Error linking issue to case ${newCase.id}:`,
                error
              );
            }
          }

          // Handle tags - upsert and attach to test case (only if user opted for auto-generation)
          if (autoGenerateTags && testCase.tags && testCase.tags.length > 0) {
            try {
              const tagIds: number[] = [];

              for (const tagName of testCase.tags) {
                try {
                  // Upsert the tag (create if doesn't exist, get if exists)
                  const tag = await upsertTag.mutateAsync({
                    where: { name: tagName.trim() },
                    update: {}, // No updates needed, just return existing
                    create: {
                      name: tagName.trim(),
                      isDeleted: false,
                    },
                  });

                  if (tag?.id) {
                    tagIds.push(tag.id);
                  }
                } catch (tagError) {
                  console.error(`Error upserting tag "${tagName}":`, tagError);
                  // Continue with other tags even if one fails
                }
              }

              // Connect all successfully created/found tags to the test case
              if (tagIds.length > 0) {
                await updateRepositoryCase.mutateAsync({
                  where: { id: newCase.id },
                  data: {
                    order: calculatedOrder, // Explicitly preserve the order
                    tags: {
                      connect: tagIds.map((id) => ({ id })),
                    },
                  },
                });
              }
            } catch (error) {
              console.error(
                `Error handling tags for test case ${testCase.name}:`,
                error
              );
              // Don't fail the import if tags fail - just log the error
            }
          }

          importedCount++;
          setImportProgress(importedCount);
        } catch (error) {
          console.error(`Error importing test case ${testCase.name}:`, error);
        }
      }

      toast.success(
        t("generateTestCases.success.imported", {
          count: importedCount,
        })
      );

      onImportComplete?.();
      setOpen(false);
      resetWizard();
    } catch (error) {
      console.error("Error importing test cases:", error);

      // Provide detailed error message for import failures
      let errorMessage = t("generateTestCases.errors.importFailed");

      if (error instanceof Error) {
        if (error.message.includes("template not found")) {
          errorMessage =
            "Selected template could not be found. Please refresh and try again.";
        } else if (
          error.message.includes("repository") ||
          error.message.includes("repositoryId")
        ) {
          errorMessage =
            "Project repository configuration error. Please contact your administrator.";
        } else if (
          error.message.includes("workflow") ||
          error.message.includes("stateId")
        ) {
          errorMessage =
            "Project workflow configuration error. Please verify project settings.";
        } else if (
          error.message.includes("permission") ||
          error.message.includes("forbidden")
        ) {
          errorMessage =
            "You don't have permission to create test cases in this project.";
        } else if (
          error.message.includes("validation") ||
          error.message.includes("constraint")
        ) {
          errorMessage =
            "Data validation failed. Please check test case content and try again.";
        } else if (
          error.message.includes("database") ||
          error.message.includes("connection")
        ) {
          errorMessage =
            "Database connection error. Please try again in a moment.";
        } else if (error.message.trim().length > 10) {
          errorMessage = `Import failed: ${error.message}`;
        }
      }

      toast.error(errorMessage);
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const toggleTestCaseSelection = (
    testCaseId: string,
    forceChecked?: boolean | "indeterminate"
  ) => {
    setSelectedTestCases((prev) => {
      const newSelection = new Set(prev);
      const shouldSelect =
        typeof forceChecked === "boolean"
          ? forceChecked
          : forceChecked === "indeterminate"
            ? true
            : !newSelection.has(testCaseId);

      if (shouldSelect) {
        newSelection.add(testCaseId);
      } else {
        newSelection.delete(testCaseId);
      }
      return newSelection;
    });
  };

  const updateGeneratedTestCase = (
    testCaseId: string,
    updater: (current: GeneratedTestCase) => GeneratedTestCase
  ) => {
    setGeneratedTestCases((prev) =>
      prev.map((testCase) =>
        testCase.id === testCaseId ? updater(testCase) : testCase
      )
    );
  };

  const startEditingTestCase = (testCaseId: string) => {
    setEditingTestCaseIds((prev) => {
      const next = new Set(prev);
      next.add(testCaseId);
      return next;
    });
  };

  const stopEditingTestCase = (testCaseId: string) => {
    setEditingTestCaseIds((prev) => {
      const next = new Set(prev);
      next.delete(testCaseId);
      return next;
    });
  };

  const handleSaveEditedTestCase = (updatedTestCase: GeneratedTestCase) => {
    updateGeneratedTestCase(updatedTestCase.id, () => updatedTestCase);
    stopEditingTestCase(updatedTestCase.id);
  };

  // Save all test cases that are currently in edit mode
  const saveAllEditedTestCases = () => {
    formSubmitHandlersRef.current.forEach((submitHandler) => {
      submitHandler();
    });
  };

  // Handle import with unsaved edits check
  const handleImportClick = () => {
    if (editingTestCaseIds.size > 0) {
      // There are unsaved edits, show dialog
      setShowUnsavedEditsDialog(true);
    } else {
      // No unsaved edits, proceed with import
      void importSelectedTestCases();
    }
  };

  // Handle save all and import
  const handleSaveAllAndImport = () => {
    saveAllEditedTestCases();
    setShowUnsavedEditsDialog(false);
    // Wait a tick for state updates to complete
    setTimeout(() => {
      void importSelectedTestCases();
    }, 100);
  };

  // Handle discard and import
  const handleDiscardAndImport = () => {
    // Stop editing all test cases without saving
    setEditingTestCaseIds(new Set());
    setShowUnsavedEditsDialog(false);
    void importSelectedTestCases();
  };

  interface GeneratedTestCaseCardProps {
    testCase: GeneratedTestCase;
    template: any;
    selectedFieldIds: Set<number>;
    isSelected: boolean;
    onSelectionChange: (checked: boolean | "indeterminate") => void;
    isEditing: boolean;
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onSave: (updated: GeneratedTestCase) => void;
    autoGenerateTags: boolean;
    t: any;
    tCommon: any;
    session: any;
    projectId: number;
    index: number;
    formSubmitHandlersRef: React.MutableRefObject<Map<string, () => void>>;
  }

  const GeneratedTestCaseCard = ({
    testCase,
    template,
    selectedFieldIds,
    isSelected,
    onSelectionChange,
    isEditing,
    onStartEdit,
    onCancelEdit,
    onSave,
    autoGenerateTags,
    t,
    tCommon,
    session,
    projectId,
    index,
    formSubmitHandlersRef,
  }: GeneratedTestCaseCardProps) => {
    const cardRef = useRef<HTMLDivElement>(null);

    // Scroll to card when entering edit mode
    useEffect(() => {
      if (isEditing && cardRef.current) {
        cardRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }, [isEditing]);

    const selectedTemplateFields = useMemo(
      () =>
        template.caseFields
          .filter((field: any) => selectedFieldIds.has(field.caseField.id))
          .sort((a: any, b: any) => a.order - b.order),
      [template.caseFields, selectedFieldIds]
    );

    const stepsField = useMemo(
      () =>
        selectedTemplateFields.find(
          (field: any) => field.caseField.type.type === "Steps"
        ),
      [selectedTemplateFields]
    );

    const mapFieldValueForForm = (field: any, rawValue: any) => {
      const fieldType = field.caseField.type.type;

      if (fieldType === "Steps") {
        if (Array.isArray(rawValue)) {
          return rawValue.map((step: any, index: number) => ({
            ...step,
            order: step?.order ?? index,
            step: ensureTipTapJSON(step?.step ?? ""),
            expectedResult: ensureTipTapJSON(step?.expectedResult ?? ""),
            isShared: step?.isShared ?? Boolean(step?.sharedStepGroupId),
            sharedStepGroupId: step?.sharedStepGroupId ?? null,
            sharedStepGroupName: step?.sharedStepGroupName ?? null,
          }));
        }

        if (rawValue && typeof rawValue === "object") {
          if (Array.isArray((rawValue as any)?.content)) {
            return [
              {
                step: ensureTipTapJSON(rawValue),
                expectedResult: ensureTipTapJSON(""),
                order: 0,
                isShared: false,
                sharedStepGroupId: null,
                sharedStepGroupName: null,
              },
            ];
          }

          if ((rawValue as any).step || (rawValue as any).expectedResult) {
            return [
              {
                ...rawValue,
                step: ensureTipTapJSON((rawValue as any).step ?? ""),
                expectedResult: ensureTipTapJSON(
                  (rawValue as any).expectedResult ?? ""
                ),
                order: (rawValue as any).order ?? 0,
                isShared: (rawValue as any).isShared ?? false,
                sharedStepGroupId: (rawValue as any).sharedStepGroupId ?? null,
                sharedStepGroupName:
                  (rawValue as any).sharedStepGroupName ?? null,
              },
            ];
          }
        }

        if (typeof rawValue === "string" && rawValue.trim().length > 0) {
          return [
            {
              step: ensureTipTapJSON(rawValue),
              expectedResult: ensureTipTapJSON(""),
              order: 0,
              isShared: false,
              sharedStepGroupId: null,
              sharedStepGroupName: null,
            },
          ];
        }

        return [];
      }

      if (fieldType === "Dropdown") {
        if (typeof rawValue === "number") return rawValue;
        if (typeof rawValue === "string") {
          try {
            JSON.parse(rawValue);
          } catch {
            const option = field.caseField.fieldOptions?.find(
              (fo: any) => fo.fieldOption.name === rawValue
            );
            if (option) return option.fieldOption.id;
            const parsed = Number(rawValue);
            return Number.isNaN(parsed) ? null : parsed;
          }
        }
        return rawValue ?? null;
      }

      if (fieldType === "Multi-Select") {
        const valuesArray = Array.isArray(rawValue)
          ? rawValue
          : typeof rawValue === "string" && rawValue.length > 0
            ? rawValue
                .split(/\n|,/)
                .map((value: string) => value.trim())
                .filter((value: string) => value.length > 0)
            : [];

        return valuesArray
          .map((value: any) => {
            if (typeof value === "number") return value;
            const option = field.caseField.fieldOptions?.find(
              (fo: any) => fo.fieldOption.name === value
            );
            if (option) {
              return option.fieldOption.id;
            }
            const parsed = Number(value);
            return Number.isNaN(parsed) ? null : parsed;
          })
          .filter((value: any) => value !== null);
      }

      if (fieldType === "Checkbox") {
        return Boolean(rawValue);
      }

      if (fieldType === "Text Long") {
        return serializeTipTapJSON(rawValue);
      }

      if (fieldType === "Date") {
        if (!rawValue) return null;
        if (rawValue instanceof Date) return rawValue;
        const dateCandidate = new Date(rawValue);
        return Number.isNaN(dateCandidate.getTime()) ? null : dateCandidate;
      }

      return rawValue ?? "";
    };

    const mapFormValueToFieldValue = (field: any, value: any) => {
      const fieldType = field.caseField.type.type;

      switch (fieldType) {
        case "Dropdown":
          return value ?? null;
        case "Multi-Select":
          return Array.isArray(value) ? value : [];
        case "Checkbox":
          return Boolean(value);
        case "Text Long":
          return serializeTipTapJSON(value);
        case "Integer":
        case "Number":
          if (value === null || value === undefined || value === "") {
            return null;
          }
          return Number(value);
        case "Date":
          if (!value) return null;
          if (value instanceof Date) {
            return value.toISOString();
          }
          try {
            const parsed = new Date(value);
            return parsed.toISOString();
          } catch {
            return value;
          }
        default:
          return value ?? null;
      }
    };

    const mapStepsFormValueToGeneratedSteps = (
      steps: any[]
    ): GeneratedTestCase["steps"] => {
      if (!Array.isArray(steps)) return [];
      return steps.map((step, index) => ({
        id: typeof step?.id === "number" ? step.id : undefined,
        order: step?.order ?? index,
        step: ensureTipTapJSON(step?.step ?? ""),
        expectedResult: ensureTipTapJSON(step?.expectedResult ?? ""),
        isShared: step?.isShared ?? false,
        sharedStepGroupId: step?.sharedStepGroupId ?? null,
        sharedStepGroupName:
          step?.sharedStepGroupName ?? step?.sharedStepGroup?.name ?? null,
        sharedStepGroup: step?.sharedStepGroup ?? null,
        isDeleted: step?.isDeleted ?? false,
        testCaseId: step?.testCaseId ?? 0,
      }));
    };

    const defaultValues = useMemo(() => {
      const initial: Record<string, any> = {
        name: testCase.name,
        tagsInput: (testCase.tags || []).join(", "),
      };

      selectedTemplateFields.forEach((field: any) => {
        const displayName = field.caseField.displayName;
        const fieldId = field.caseField.id.toString();
        const rawValue =
          field.caseField.type.type === "Steps"
            ? testCase.steps || []
            : testCase.fieldValues[displayName];
        initial[fieldId] = mapFieldValueForForm(field, rawValue);
      });

      return initial;
    }, [testCase, selectedTemplateFields]);

    const formMethods = useForm({
      defaultValues,
    });

    const {
      control,
      handleSubmit,
      reset,
      formState: { errors },
    } = formMethods;

    useEffect(() => {
      if (isEditing) {
        reset(defaultValues);
      }
    }, [isEditing, defaultValues, reset]);

    const parseTags = (rawValue: string | undefined) => {
      if (!rawValue) return [];
      return rawValue
        .split(",")
        .map((tag) => tag.trim())
        .filter(
          (tag, index, self) => tag.length > 0 && self.indexOf(tag) === index
        );
    };

    const handleSave = handleSubmit((data) => {
      const updatedFieldValues: Record<string, any> = {
        ...testCase.fieldValues,
      };

      selectedTemplateFields.forEach((field: any) => {
        const displayName = field.caseField.displayName;
        const fieldId = field.caseField.id.toString();

        if (field.caseField.type.type === "Steps") {
          delete updatedFieldValues[displayName];
          return;
        }

        updatedFieldValues[displayName] = mapFormValueToFieldValue(
          field,
          data[fieldId]
        );
      });

      let updatedSteps = testCase.steps;
      if (stepsField) {
        const stepsData = data[stepsField.caseField.id.toString()] || [];
        updatedSteps = mapStepsFormValueToGeneratedSteps(stepsData);
      }

      const nextTestCase: GeneratedTestCase = {
        ...testCase,
        name: data.name?.trim() ? data.name.trim() : testCase.name,
        automated: false,
        tags: autoGenerateTags ? parseTags(data.tagsInput) : testCase.tags,
        fieldValues: updatedFieldValues,
        steps: updatedSteps,
      };

      onSave(nextTestCase);
    });

    const handleCancel = () => {
      reset(defaultValues);
      onCancelEdit();
    };

    // Register/unregister form submit handler for programmatic submission
    useEffect(() => {
      const handlers = formSubmitHandlersRef.current;
      const id = testCase.id;

      if (isEditing) {
        handlers.set(id, handleSave);
      } else {
        handlers.delete(id);
      }
      // Cleanup on unmount
      return () => {
        handlers.delete(id);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing, testCase.id, handleSave]);

    const stepsForDisplay = useMemo(() => {
      if (!testCase.steps) return [];
      return testCase.steps.map((step, index) => {
        const existingGroup = step?.sharedStepGroup as any;
        const sharedStepGroup = existingGroup
          ? {
              name: existingGroup.name ?? null,
              isDeleted: existingGroup.isDeleted ?? false,
            }
          : step?.sharedStepGroupName
            ? { name: step.sharedStepGroupName, isDeleted: false }
            : null;

        return {
          id: typeof step?.id === "number" ? step.id : index,
          order: step?.order ?? index,
          step: ensureTipTapJSON(step?.step ?? ""),
          expectedResult: ensureTipTapJSON(step?.expectedResult ?? ""),
          sharedStepGroupId: step?.sharedStepGroupId ?? null,
          sharedStepGroupName: step?.sharedStepGroupName ?? null,
          sharedStepGroup,
          isShared: step?.isShared ?? Boolean(step?.sharedStepGroupId),
          isDeleted: step?.isDeleted ?? false,
          testCaseId:
            typeof step?.testCaseId === "number" ? step.testCaseId : 0,
        };
      });
    }, [testCase.steps]);

    const priorityField = useMemo(() => {
      return selectedTemplateFields.find((field: any) =>
        field.caseField.displayName.toLowerCase().includes("priority")
      );
    }, [selectedTemplateFields]);

    const priorityValue = priorityField
      ? testCase.fieldValues[priorityField.caseField.displayName]
      : null;

    const renderFieldList = (isEdit: boolean) => (
      <div className="mt-3 border-t pt-3 space-y-4">
        {selectedTemplateFields.map((field: any) => {
          const displayName = field.caseField.displayName;
          const fieldId = field.caseField.id.toString();
          const fieldType = field.caseField.type.type;

          const commonProps = {
            fieldType,
            caseId: `generated-${testCase.id}`,
            template,
            fieldId: field.caseField.id,
            session,
            projectId,
            previousFieldValue: undefined,
            fieldValue: testCase.fieldValues[displayName],
            stepsForDisplay:
              fieldType === "Steps" ? stepsForDisplay : undefined,
            explicitFieldNameForSteps:
              fieldType === "Steps" ? fieldId : undefined,
          } as const;

          return (
            <div key={`field-${field.caseField.id}`} className="space-y-2">
              <div className="font-medium text-sm text-primary border-b border-muted-foreground/50 pb-1">
                {displayName}
              </div>
              <FieldValueRenderer
                {...commonProps}
                isEditMode={isEdit}
                isSubmitting={false}
                control={control}
                errors={errors}
              />
            </div>
          );
        })}
      </div>
    );

    if (isEditing) {
      return (
        <div
          ref={cardRef}
          className="border rounded-lg p-4 transition-colors border-primary/60 bg-primary/5"
        >
          <FormProvider {...formMethods}>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="flex items-start gap-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={onSelectionChange}
                    className="mt-1"
                  />
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary bg-background text-sm font-medium text-primary">
                    {index + 1}
                  </div>
                </label>
                <div className="flex-1 space-y-4">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`generated-${testCase.id}-name`}>
                        {tCommon("fields.name")}
                      </Label>
                      <Controller
                        name="name"
                        control={control}
                        render={({ field }) => (
                          <Input
                            id={`generated-${testCase.id}-name`}
                            {...field}
                            value={field.value ?? ""}
                          />
                        )}
                      />
                    </div>
                    {autoGenerateTags && (
                      <div className="space-y-2">
                        <Label htmlFor={`generated-${testCase.id}-tags`}>
                          {tCommon("fields.tags")}
                        </Label>
                        <Controller
                          name="tagsInput"
                          control={control}
                          render={({ field }) => (
                            <Input
                              id={`generated-${testCase.id}-tags`}
                              {...field}
                              value={field.value ?? ""}
                              placeholder="Tag A, Tag B"
                            />
                          )}
                        />
                      </div>
                    )}
                  </div>

                  {renderFieldList(true)}

                  <div className="flex flex-wrap items-center gap-2">
                    {autoGenerateTags &&
                      testCase.tags?.map((tag, index) => (
                        <Badge
                          key={`editing-${testCase.id}-tag-${index}`}
                          variant="outline"
                          className="text-xs text-primary"
                        >
                          <Tag className="h-3 w-3 shrink-0 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCancel}>
                  {tCommon("actions.cancel")}
                </Button>
                <Button type="submit">{tCommon("actions.save")}</Button>
              </div>
            </form>
          </FormProvider>
        </div>
      );
    }

    return (
      <div
        ref={cardRef}
        className={`border rounded-lg p-4 transition-colors ${
          isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
        }`}
      >
        <div className="flex items-start gap-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={isSelected}
              onCheckedChange={onSelectionChange}
              className="mt-1"
            />
            <div className="flex h-7 w-7 -mt-0.5 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-background text-sm font-medium text-primary">
              {index + 1}
            </div>
          </label>
          <div className="flex-1 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h4 className="font-medium wrap-break-word">{testCase.name}</h4>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onStartEdit}>
                  <SquarePen className="w-4 h-4 mr-1" />
                  {tCommon("actions.edit")}
                </Button>
              </div>
            </div>

            {renderFieldList(false)}

            <div className="flex flex-wrap items-center gap-2">
              {autoGenerateTags &&
                testCase.tags?.map((tag, index) => (
                  <Badge
                    key={`${testCase.id}-tag-${index}`}
                    variant="outline"
                    className="text-xs text-primary"
                  >
                    <Tag className="h-3 w-3 shrink-0 mr-1" />
                    {tag}
                  </Badge>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const canProceed = () => {
    switch (currentStep) {
      case WizardStep.SELECT_ISSUE:
        // If no external integrations, only allow document source
        if (!hasActiveIntegrations) {
          return documentRequirements !== null;
        }
        return sourceType === "issue"
          ? selectedIssue !== null
          : documentRequirements !== null;
      case WizardStep.SELECT_TEMPLATE:
        return selectedTemplateId !== null;
      case WizardStep.ADD_NOTES:
        return true; // Notes are optional
      case WizardStep.REVIEW_GENERATED:
        return selectedTestCases.size > 0;
      default:
        return false;
    }
  };

  const isLastStep = currentStep === WizardStep.REVIEW_GENERATED;

  // Show the button if user has permissions and LLM is available (external integrations are optional)
  if (!canAddEdit || !hasActiveLlm) {
    return null;
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) {
            resetWizard();
          }
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline">
            <Sparkles className="w-4 h-4 " />
            {t("generateTestCases.buttonText")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[900px] lg:max-w-[1200px] max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              {t("generateTestCases.title")}
            </DialogTitle>
            <DialogDescription>
              {t("generateTestCases.description")}
            </DialogDescription>
            <Alert className="mt-2 bg-primary/10 border-primary/50">
              <AlertDescription>
                <div className="flex items-center gap-2 text-xs text-left">
                  <Info className="w-4 h-4 text-muted-foreground shrink-0" />
                  {(existingTestCases?.length ?? 0) >= 50
                    ? t(
                        "generateTestCases.selectSource.folderContextTipMax",
                        {
                          count: existingTestCases?.length ?? 0,
                          folderName:
                            folderName ??
                            t("generateTestCases.selectSource.currentFolder"),
                        }
                      )
                    : t("generateTestCases.selectSource.folderContextTip", {
                        count: existingTestCases?.length ?? 0,
                        folderName:
                          folderName ??
                          t("generateTestCases.selectSource.currentFolder"),
                      })}
                </div>
              </AlertDescription>
            </Alert>
          </DialogHeader>

          <div className="px-6 py-4 shrink-0">
            <WizardProgress
              steps={wizardSteps}
              activeStep={currentStep}
              maxUnlockedStep={maxUnlockedStep}
              onStepSelect={handleStepSelect}
              isImporting={isImporting}
            />
          </div>

          <div className="flex-1 min-h-0 px-4 overflow-y-auto">
            <div className="space-y-6 pb-4">
              {isImporting && (
                <LoadingSpinnerAlert
                  message={t("generateTestCases.importing", {
                    count: selectedTestCases.size - importProgress,
                  })}
                />
              )}
              {llmError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 shadow-sm">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-destructive">
                            {llmError.title}
                          </p>
                          <p className="whitespace-pre-line text-sm text-muted-foreground">
                            {llmError.message}
                          </p>
                          {llmError.detail && (
                            <p className="whitespace-pre-line text-sm text-foreground">
                              {llmError.detail}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Button
                          size="sm"
                          onClick={handleRetryGeneration}
                          disabled={isGenerating}
                        >
                          {isGenerating
                            ? tCommon("loading")
                            : t(`${llmErrorTranslationKey}.retryButton` as any)}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleDismissError}
                          className="h-8 px-2 text-xs"
                        >
                          {t(`${llmErrorTranslationKey}.dismissButton` as any)}
                        </Button>
                      </div>
                    </div>

                    {llmError.suggestions.length > 0 && (
                      <div className="rounded-md bg-destructive/10 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                          {t(
                            `${llmErrorTranslationKey}.suggestionsHeading` as any
                          )}
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {llmError.suggestions.map((suggestion) => (
                            <li key={suggestion}>{suggestion}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {t(`${llmErrorTranslationKey}.timestampLabel` as any)}:{" "}
                        {new Date(llmError.timestamp).toLocaleString()}
                      </span>
                      {llmError.raw && (
                        <>
                          <button
                            type="button"
                            className="font-medium text-destructive underline"
                            onClick={() => setShowErrorDetails((prev) => !prev)}
                          >
                            {showErrorDetails
                              ? t(
                                  `${llmErrorTranslationKey}.hideDetails` as any
                                )
                              : t(
                                  `${llmErrorTranslationKey}.showDetails` as any
                                )}
                          </button>
                          <button
                            type="button"
                            className="font-medium text-destructive underline"
                            onClick={handleCopyErrorDetails}
                          >
                            {t(`${llmErrorTranslationKey}.copyDetails` as any)}
                          </button>
                        </>
                      )}
                    </div>

                    {showErrorDetails && llmError.raw && (
                      <pre className="max-h-48 overflow-auto rounded-md border border-destructive/20 bg-background/80 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                        {llmError.raw}
                      </pre>
                    )}
                  </div>
                </div>
              )}

              {/* Step 1: Select Source */}
              {currentStep === WizardStep.SELECT_ISSUE && (
                <Card shadow="none">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Search className="w-5 h-5" />
                      {t("generateTestCases.selectSource.title")}
                    </CardTitle>
                    <CardDescription>
                      {t("generateTestCases.selectSource.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs
                      value={sourceType}
                      onValueChange={(value) =>
                        setSourceType(value as "issue" | "document")
                      }
                    >
                      {hasActiveIntegrations ? (
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="issue">
                            {t("generateTestCases.selectSource.fromIssue")}
                          </TabsTrigger>
                          <TabsTrigger value="document">
                            {t("generateTestCases.selectSource.fromDocument")}
                          </TabsTrigger>
                        </TabsList>
                      ) : (
                        <TabsList className="grid w-full grid-cols-1">
                          <TabsTrigger value="document">
                            {t("generateTestCases.selectSource.fromDocument")}
                          </TabsTrigger>
                        </TabsList>
                      )}

                      {hasActiveIntegrations && (
                        <TabsContent value="issue" className="mt-4">
                          {selectedIssue ? (
                            <div className="border rounded-lg p-4 max-h-64 overflow-y-auto">
                              <div className="flex items-start justify-between mb-3">
                                <div className="space-y-3 flex-1">
                                  {/* Header with issue key and external link */}
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="default"
                                      className="font-bold text-sm"
                                    >
                                      {selectedIssue.key ||
                                        selectedIssue.externalKey}
                                    </Badge>
                                    {(selectedIssue.url ||
                                      selectedIssue.externalUrl) && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => {
                                          const url =
                                            selectedIssue.url ||
                                            selectedIssue.externalUrl;
                                          if (url) {
                                            window.open(
                                              url,
                                              "_blank",
                                              "noopener,noreferrer"
                                            );
                                          }
                                        }}
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        {t(
                                          "generateTestCases.openInExternalSystem",
                                          {
                                            provider: getProviderDisplayName(
                                              project?.projectIntegrations?.[0]
                                                ?.integration?.provider
                                            ),
                                          }
                                        )}
                                      </Button>
                                    )}
                                    {selectedIssue.priority && (
                                      <Badge
                                        variant="outline"
                                        style={getPriorityStyle(
                                          selectedIssue.priority
                                        )}
                                      >
                                        {selectedIssue.priority}
                                      </Badge>
                                    )}
                                    <Badge
                                      variant="outline"
                                      style={getStatusStyle(
                                        selectedIssue.status ||
                                          selectedIssue.externalStatus
                                      )}
                                    >
                                      {selectedIssue.status ||
                                        selectedIssue.externalStatus}
                                    </Badge>
                                  </div>

                                  {/* Issue title */}
                                  <div>
                                    <h4 className="font-medium text-base leading-tight">
                                      {selectedIssue.title}
                                    </h4>
                                  </div>

                                  {/* Issue description */}
                                  {selectedIssue.description && (
                                    <div>
                                      <Label className="text-xs font-medium text-muted-foreground mb-1">
                                        {tCommon("fields.description")}
                                      </Label>
                                      <div className="text-sm text-muted-foreground">
                                        <IssueDescriptionText
                                          description={
                                            selectedIssue.description
                                          }
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>

                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSelectedIssue(null)}
                                  className="ml-4"
                                >
                                  {tCommon("actions.change")}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              onClick={() => setIsSearchOpen(true)}
                              variant="outline"
                              className="w-full"
                            >
                              <Search className="w-4 h-4 " />
                              {t("generateTestCases.selectIssue.searchButton")}
                            </Button>
                          )}
                        </TabsContent>
                      )}

                      <TabsContent value="document" className="mt-4">
                        {documentRequirements ? (
                          <div className="border rounded-lg p-4 max-h-64 overflow-y-auto">
                            <div className="flex items-start justify-between">
                              <div className="space-y-2">
                                <h4 className="font-medium">
                                  {documentRequirements.title}
                                </h4>
                                <p className="text-sm text-muted-foreground line-clamp-3">
                                  {documentRequirements.description}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDocumentRequirements(null)}
                              >
                                {tCommon("actions.change")}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div>
                              <Label
                                htmlFor="doc-description"
                                className="text-sm font-medium"
                              >
                                {t(
                                  "generateTestCases.selectSource.documentDescription"
                                )}
                              </Label>
                              <Textarea
                                id="doc-description"
                                placeholder={t(
                                  "generateTestCases.selectSource.documentDescriptionPlaceholder"
                                )}
                                rows={8}
                                className="mt-1"
                              />
                            </div>
                            <Button
                              onClick={() => {
                                const description = (
                                  document.getElementById(
                                    "doc-description"
                                  ) as HTMLTextAreaElement
                                )?.value;

                                if (description) {
                                  setDocumentRequirements({
                                    id: `doc_${Date.now()}`,
                                    title: "Requirements Document",
                                    description,
                                    isDocument: true,
                                  });
                                }
                              }}
                              className="w-full"
                            >
                              {t("generateTestCases.selectSource.saveDocument")}
                            </Button>
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              )}

              {/* Step 2: Select Template */}
              {currentStep === WizardStep.SELECT_TEMPLATE && (
                <Card shadow="none">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      {t("generateTestCases.selectTemplate.title")}
                    </CardTitle>
                    <CardDescription>
                      {t("generateTestCases.selectTemplate.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Select
                      value={selectedTemplateId?.toString() || ""}
                      onValueChange={(value) =>
                        setSelectedTemplateId(Number(value))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t(
                            "generateTestCases.selectTemplate.placeholder"
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {templates?.map((template) => (
                          <SelectItem
                            key={template.id}
                            value={template.id.toString()}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span>{template.templateName}</span>
                              {template.isDefault && (
                                <Badge variant="secondary" className="">
                                  {tCommon("fields.default")}
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedTemplateId && (
                      <div className="mt-4 p-4 bg-muted rounded-lg">
                        <h5 className="font-medium mb-2">
                          {t("generateTestCases.selectTemplate.fields")}
                        </h5>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm text-muted-foreground">
                            {t(
                              "generateTestCases.selectTemplate.fieldsDescription"
                            )}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={selectAllFields}
                              type="button"
                            >
                              {t("generateTestCases.selectTemplate.selectAll")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={deselectOptionalFields}
                              type="button"
                            >
                              {t(
                                "generateTestCases.selectTemplate.requiredOnly"
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {templates
                            ?.find((t) => t.id === selectedTemplateId)
                            ?.caseFields.slice()
                            .sort((a, b) => a.order - b.order)
                            .map((field) => (
                              <div
                                key={field.caseFieldId}
                                className="flex items-center justify-between p-2 rounded border bg-background"
                              >
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    id={`field-${field.caseFieldId}`}
                                    checked={selectedFieldIds.has(
                                      field.caseFieldId
                                    )}
                                    onCheckedChange={() =>
                                      toggleFieldSelection(
                                        field.caseFieldId,
                                        field.caseField.isRequired
                                      )
                                    }
                                    disabled={field.caseField.isRequired}
                                  />
                                  <Label
                                    htmlFor={`field-${field.caseFieldId}`}
                                    className={`text-sm cursor-pointer ${
                                      field.caseField.isRequired
                                        ? "text-muted-foreground"
                                        : ""
                                    }`}
                                  >
                                    {field.caseField.displayName}
                                  </Label>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">
                                    {field.caseField.type.type}
                                  </Badge>
                                  {field.caseField.isRequired && (
                                    <Badge
                                      variant="destructive"
                                      className="text-xs"
                                    >
                                      {tCommon("fields.required")}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Step 3: Add Notes */}
              {currentStep === WizardStep.ADD_NOTES && (
                <Card shadow="none">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Settings className="w-5 h-5" />
                      {t("generateTestCases.addNotes.title")}
                    </CardTitle>
                    <CardDescription>
                      {t("generateTestCases.addNotes.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className=" overflow-y-auto">
                    <div className="mb-4">
                      <Label className="text-sm font-medium mb-2 block">
                        {t("generateTestCases.addNotes.quantity")}
                      </Label>
                      <Select value={quantity} onValueChange={setQuantity}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="just_one">
                            {t(
                              "generateTestCases.addNotes.quantityOptions.justOne"
                            )}
                          </SelectItem>
                          <SelectItem value="couple">
                            {t(
                              "generateTestCases.addNotes.quantityOptions.couple"
                            )}
                          </SelectItem>
                          <SelectItem value="few">
                            {t(
                              "generateTestCases.addNotes.quantityOptions.few"
                            )}
                          </SelectItem>
                          <SelectItem value="several">
                            {t(
                              "generateTestCases.addNotes.quantityOptions.several"
                            )}
                          </SelectItem>
                          <SelectItem value="many">
                            {t(
                              "generateTestCases.addNotes.quantityOptions.many"
                            )}
                          </SelectItem>
                          <SelectItem value="all">
                            {t(
                              "generateTestCases.addNotes.quantityOptions.maximum"
                            )}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Textarea
                      placeholder={t("generateTestCases.addNotes.placeholder")}
                      value={userNotes}
                      onChange={(e) => setUserNotes(e.target.value)}
                      rows={6}
                      className="mb-4"
                    />

                    {/* Auto-generate tags option */}
                    <div className="flex items-center space-x-2 mb-4">
                      <Checkbox
                        id="auto-generate-tags"
                        checked={autoGenerateTags}
                        onCheckedChange={(checked) =>
                          setAutoGenerateTags(checked === true)
                        }
                      />
                      <Label
                        htmlFor="auto-generate-tags"
                        className="text-sm font-medium cursor-pointer"
                      >
                        {t("generateTestCases.autoGenerateTags")}
                      </Label>
                    </div>

                    {/* Quick suggestions */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        {t("generateTestCases.addNotes.suggestions")}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          {
                            key: "security",
                            value: t(
                              "generateTestCases.addNotes.suggestionItems.security"
                            ),
                          },
                          {
                            key: "edgeCases",
                            value: t(
                              "generateTestCases.addNotes.suggestionItems.edgeCases"
                            ),
                          },
                          {
                            key: "happyPath",
                            value: t(
                              "generateTestCases.addNotes.suggestionItems.happyPath"
                            ),
                          },
                          {
                            key: "mobile",
                            value: t(
                              "generateTestCases.addNotes.suggestionItems.mobile"
                            ),
                          },
                          {
                            key: "api",
                            value: t(
                              "generateTestCases.addNotes.suggestionItems.api"
                            ),
                          },
                          {
                            key: "accessibility",
                            value: t(
                              "generateTestCases.addNotes.suggestionItems.accessibility"
                            ),
                          },
                        ].map((suggestion) => (
                          <Button
                            key={suggestion.key}
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setUserNotes((prev) =>
                                prev
                                  ? `${prev}\n${suggestion.value}`
                                  : suggestion.value
                              );
                            }}
                          >
                            {suggestion.value}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Step 4: Review Generated Test Cases */}
              {currentStep === WizardStep.REVIEW_GENERATED && (
                <Card shadow="none">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Eye className="w-5 h-5" />
                        {t("generateTestCases.review.title")}
                      </div>
                      {generatedTestCases.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (
                                selectedTestCases.size ===
                                generatedTestCases.length
                              ) {
                                setSelectedTestCases(new Set());
                              } else {
                                setSelectedTestCases(
                                  new Set(generatedTestCases.map((tc) => tc.id))
                                );
                              }
                            }}
                          >
                            {selectedTestCases.size ===
                            generatedTestCases.length
                              ? tCommon("actions.deselectAll")
                              : tCommon("actions.selectAll")}
                          </Button>
                          <Badge variant="outline">
                            {t("generateTestCases.review.selected", {
                              count: selectedTestCases.size,
                              total: generatedTestCases.length,
                            })}
                          </Badge>
                        </div>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {t("generateTestCases.review.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isGenerating ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <Sparkles className="w-8 h-8 animate-spin mb-4 shrink-0" />
                        <span className="select-none hidden md:inline">
                          {t("generateTestCases.buttonText")}
                        </span>
                      </div>
                    ) : generatedTestCases.length === 0 ? (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          {t("generateTestCases.errors.noTestCasesGenerated")}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-4">
                        {generatedTestCases.map((testCase, index) => {
                          const template = templates?.find(
                            (t) => t.id === selectedTemplateId
                          );
                          if (!template) {
                            return null;
                          }

                          return (
                            <GeneratedTestCaseCard
                              key={testCase.id}
                              testCase={testCase}
                              template={template}
                              selectedFieldIds={selectedFieldIds}
                              isSelected={selectedTestCases.has(testCase.id)}
                              onSelectionChange={(checked) =>
                                toggleTestCaseSelection(testCase.id, checked)
                              }
                              isEditing={editingTestCaseIds.has(testCase.id)}
                              onStartEdit={() =>
                                startEditingTestCase(testCase.id)
                              }
                              onCancelEdit={() =>
                                stopEditingTestCase(testCase.id)
                              }
                              onSave={handleSaveEditedTestCase}
                              autoGenerateTags={autoGenerateTags}
                              t={t}
                              tCommon={tCommon}
                              session={session}
                              projectId={projectId}
                              index={index}
                              formSubmitHandlersRef={formSubmitHandlersRef}
                            />
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Dialog Footer */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t shrink-0">
            <div className="flex items-center gap-2">
              {currentStep > WizardStep.SELECT_ISSUE && (
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={isImporting}
                >
                  <ChevronLeft className="w-4 h-4 " />
                  {tCommon("actions.back")}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isImporting}
              >
                {tCommon("actions.cancel")}
              </Button>

              {isLastStep ? (
                <Button
                  onClick={handleImportClick}
                  disabled={selectedTestCases.size === 0 || isImporting}
                >
                  {isImporting ? (
                    <Sparkles className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <Download className="w-4 h-4 " />
                  )}
                  {isImporting
                    ? t("generateTestCases.import", {
                        count: selectedTestCases.size - importProgress,
                      })
                    : t("generateTestCases.import", {
                        count: selectedTestCases.size,
                      })}
                </Button>
              ) : (
                <Button
                  onClick={handleNext}
                  disabled={!canProceed() || isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Sparkles className="w-4 h-4 animate-spin shrink-0" />
                      {t("generateTestCases.buttonText")}
                    </>
                  ) : (
                    <>
                      {currentStep === WizardStep.ADD_NOTES ? (
                        <>
                          <Sparkles className="w-4 h-4" />
                          {t("generateTestCases.generate")}
                        </>
                      ) : (
                        <>
                          {tCommon("actions.next")}
                          <ChevronRight className="w-4 h-4" />
                        </>
                      )}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SearchIssuesDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        projectId={projectId}
        onIssueSelected={(issue) => {
          if (issue.isExternal) {
            const selectedIssueData = {
              id: String(issue.id),
              key: (issue as any).key || issue.externalKey || String(issue.id),
              title: issue.title,
              description: issue.description,
              status: issue.externalStatus || issue.status || "",
              priority: issue.priority,
              externalId:
                issue.externalId || (issue as any).key || issue.externalKey,
              externalKey: (issue as any).key || issue.externalKey,
              externalUrl: (issue as any).url || issue.externalUrl,
              externalStatus: issue.externalStatus || issue.status,
              url: (issue as any).url || issue.externalUrl,
              isExternal: true,
            };

            setSelectedIssue(selectedIssueData);
            setIsSearchOpen(false);
          }
        }}
      />

      {/* Unsaved Edits Dialog */}
      <Dialog
        open={showUnsavedEditsDialog}
        onOpenChange={setShowUnsavedEditsDialog}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              {t("generateTestCases.unsavedEdits.title")}
            </DialogTitle>
            <DialogDescription>
              {t("generateTestCases.unsavedEdits.description", {
                count: editingTestCaseIds.size,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <p className="text-sm text-muted-foreground">
              {t("generateTestCases.unsavedEdits.warning")}
            </p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowUnsavedEditsDialog(false)}
            >
              {tCommon("actions.cancel")}
            </Button>
            <Button variant="outline" onClick={handleDiscardAndImport}>
              {t("generateTestCases.unsavedEdits.discardAndImport")}
            </Button>
            <Button onClick={handleSaveAllAndImport}>
              {t("generateTestCases.unsavedEdits.saveAllAndImport")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Wizard Progress Component
interface WizardProgressProps {
  steps: WizardStepDefinition[];
  activeStep: WizardStep;
  maxUnlockedStep: WizardStep;
  onStepSelect?: (step: WizardStep) => void;
  isImporting?: boolean;
}

function WizardProgress({
  steps,
  activeStep,
  maxUnlockedStep,
  onStepSelect,
  isImporting = false,
}: WizardProgressProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {steps.map((step, index) => {
        const status: StepStatus =
          step.id === activeStep
            ? "active"
            : step.id < maxUnlockedStep
              ? "completed"
              : "pending";
        const Icon = step.icon;
        const isEnabled = step.id <= maxUnlockedStep && !isImporting;
        const indicatorClasses =
          status === "completed"
            ? "bg-muted-foreground/60 text-primary-foreground"
            : status === "active"
              ? "border-2 border-primary text-primary bg-background ring-offset-1 ring-offset-primary ring-1 ring-primary"
              : "bg-muted border-2 border-muted-foreground/20 text-muted-foreground";
        return (
          <div key={step.id} className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => isEnabled && onStepSelect?.(step.id)}
              disabled={!isEnabled}
              className={`flex items-center gap-2 border border-primary/60 shadow-md rounded-full py-6 text-sm font-medium transition ${
                isEnabled
                  ? "cursor-pointer text-foreground hover:bg-muted "
                  : "cursor-not-allowed text-muted-foreground border-muted-foreground/20"
              }`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full ${indicatorClasses}`}
              >
                {status === "completed" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </span>
              <span
                className={
                  status === "pending"
                    ? "text-muted-foreground"
                    : "text-foreground"
                }
              >
                {step.label}
              </span>
            </Button>
            {index < steps.length - 1 && (
              <div
                className={`hidden h-px w-12 sm:block ${
                  step.id < maxUnlockedStep
                    ? "bg-primary animate-pulse"
                    : "bg-muted"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Component to handle expandable issue descriptions
function IssueDescriptionText({ description }: { description: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isHtml = description.includes("<") && description.includes(">");

  const renderDescription = (value: string, treatAsHtml: boolean) => {
    const json = treatAsHtml
      ? convertHtmlToTipTapJSON(value)
      : convertTextToTipTapJSON(value);
    const htmlOutput = tiptapToHtml(json);

    return (
      <div
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: htmlOutput }}
      />
    );
  };

  if (description.length <= 200) {
    return renderDescription(description, isHtml);
  }

  const truncatedText = `${description.substring(0, 200)}...`;
  const displayValue = isExpanded ? description : truncatedText;

  return (
    <div>
      {renderDescription(displayValue, isHtml)}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-primary hover:text-primary/80 transition-colors ml-1 underline text-sm mt-2"
      >
        {isExpanded ? "(click to collapse)" : "(click to expand)"}
      </button>
    </div>
  );
}
