"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  useUpdateRepositoryCases,
  useFindManyWorkflows,
  useFindManyTags,
  useFindManyIssue,
  useUpdateCaseFieldValues,
  useCreateCaseFieldValues,
  useCreateSteps,
  useDeleteManySteps,
  useUpdateManyRepositoryCases,
  useUpdateSteps,
  useCreateRepositoryCaseVersions,
  useCreateCaseFieldVersionValues,
} from "~/lib/hooks";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2,
  AlertCircle,
  Info,
  LockIcon,
  Trash2,
  CircleSlash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Prisma, CaseFields as PrismaCaseField } from "@prisma/client";
import { isEqual } from "lodash";
import { FieldValueInput } from "./FieldValueInput";
import DynamicIcon from "@/components/DynamicIcon";
import { Switch } from "@/components/ui/switch";
import { emptyEditorContent } from "~/app/constants";
import { IconName } from "~/types/globals";
import FieldValueRenderer from "./[caseId]/FieldValueRenderer";
import { toast } from "sonner";
import parseDuration from "parse-duration";
import { formatSeconds } from "@/components/DurationDisplay";
import { z } from "zod/v4";
import { MAX_DURATION } from "~/app/constants";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// --- Type Definitions ---

// Type for field edit modes
type FieldEditMode = "replace" | "search-replace";

// Type for search/replace options
interface SearchReplaceOptions {
  useRegex: boolean;
  caseSensitive: boolean;
}

// Type for preview data
interface PreviewMatch {
  caseId: number;
  caseName: string;
  originalValue: string;
  newValue: string;
  matchCount: number;
  // Additional fields for Steps
  stepsPreview?: {
    stepNumber: number;
    stepMatches: number;
    expectedResultMatches: number;
    stepText?: string;
    expectedResultText?: string;
  }[];
}

// Define a more specific type for the case data needed in this modal
type BulkEditCase = Prisma.RepositoryCasesGetPayload<{
  include: {
    state: true;
    project: true;
    folder: true;
    creator: true;
    template: {
      include: {
        caseFields: {
          include: {
            caseField: {
              include: {
                type: true;
                fieldOptions: {
                  include: {
                    fieldOption: {
                      include: { icon: true; iconColor: true };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
    caseFieldValues: {
      include: {
        field: {
          include: { type: true };
        };
      };
    };
    tags: true;
    issues: true;
    steps: {
      where: { isDeleted: false };
      orderBy: { order: "asc" };
    };
    attachments: {
      where: { isDeleted: false };
      orderBy: { createdAt: "desc" };
    };
  };
}>;

// Type for field definitions (standard or custom)
interface FieldDefinition {
  key: string; // e.g., 'state', 'automated', 'dynamic_123'
  label: string;
  isCustom: boolean;
  field?: PrismaCaseField & { type: { type: string }; fieldOptions?: any[] }; // Include relevant field data for custom fields
}

interface BulkEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess: () => void;
  selectedCaseIds: number[];
  projectId: number;
}

const VARIOUS_PLACEHOLDER = "<various>";

// --- Main Component ---

export function BulkEditModal({
  isOpen,
  onClose,
  onSaveSuccess,
  selectedCaseIds,
  projectId,
}: BulkEditModalProps) {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const tRepository = useTranslations("repository");
  const tBulkEdit = useTranslations("repository.bulkEdit");
  const { data: session } = useSession();

  const [editedFields, setEditedFields] = useState<Record<string, boolean>>({});
  const [newValues, setNewValues] = useState<Record<string, any>>({});
  const [showTemplateWarning, setShowTemplateWarning] = useState(false);
  const [inlineErrors, setInlineErrors] = useState<Record<string, string[]>>(
    {}
  );
  const [hasSteps, setHasSteps] = useState(false);
  const [deletePopoverOpen, setDeletePopoverOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Search/Replace state
  const [fieldModes, setFieldModes] = useState<Record<string, FieldEditMode>>(
    {}
  );
  const [searchPatterns, setSearchPatterns] = useState<Record<string, string>>(
    {}
  );
  const [replacePatterns, setReplacePatterns] = useState<
    Record<string, string>
  >({});
  const [searchOptions, setSearchOptions] = useState<
    Record<string, SearchReplaceOptions>
  >({});
  const [previewData, setPreviewData] = useState<
    Record<string, PreviewMatch[]>
  >({});
  const [previewIndex, setPreviewIndex] = useState<Record<string, number>>({});

  // --- Fetch Permissions ---
  const { permissions: tagsPermissions, isLoading: isLoadingTagsPermissions } =
    useProjectPermissions(projectId, ApplicationArea.Tags);
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;
  const isSuperAdmin = session?.user?.access === "ADMIN";
  const canCreateTagsPerm = canAddEditTags || isSuperAdmin;

  // Fetch Restricted Fields permission (NEW)
  const {
    permissions: restrictedFieldsPermissions,
    isLoading: isLoadingRestrictedPermissions,
  } = useProjectPermissions(
    projectId,
    ApplicationArea.TestCaseRestrictedFields
  );
  const canEditRestricted = restrictedFieldsPermissions?.canAddEdit ?? false;
  const canEditRestrictedPerm = canEditRestricted || isSuperAdmin; // NEW

  // --- Data Fetching via POST to avoid URL length limits ---
  const [casesData, setCasesData] = useState<BulkEditCase[] | undefined>(
    undefined
  );
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [casesError, setCasesError] = useState<Error | null>(null);

  const fetchCases = useCallback(async () => {
    if (!isOpen || selectedCaseIds.length === 0) {
      return;
    }

    setIsLoadingCases(true);
    setCasesError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/cases/fetch-many`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            caseIds: selectedCaseIds,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch cases");
      }

      const data = await response.json();
      setCasesData(data.cases as BulkEditCase[]);
    } catch (error: any) {
      console.error("Error fetching cases:", error);
      setCasesError(error);
    } finally {
      setIsLoadingCases(false);
    }
  }, [isOpen, selectedCaseIds, projectId]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  const refetchCases = useCallback(() => {
    fetchCases();
  }, [fetchCases]);

  const { data: workflowsData, isLoading: isLoadingWorkflows } =
    useFindManyWorkflows(
      {
        where: {
          scope: "CASES",
          isDeleted: false,
          projects: { some: { projectId } },
        },
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          icon: { select: { name: true } },
          color: { select: { value: true } },
        },
      },
      { enabled: isOpen }
    );

  const { data: availableTagsData, isLoading: isLoadingTags } = useFindManyTags(
    {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    },
    { enabled: isOpen }
  );

  const { data: availableIssuesData, isLoading: isLoadingAvailableIssues } =
    useFindManyIssue(
      {
        where: { isDeleted: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true, externalId: true },
      },
      { enabled: isOpen }
    );

  const { mutateAsync: updateCasesMutation, isPending: isUpdating } =
    useUpdateRepositoryCases();
  const { mutateAsync: updateCaseFieldValue } = useUpdateCaseFieldValues();
  const { mutateAsync: createCaseFieldValues } = useCreateCaseFieldValues();
  const { mutateAsync: createSteps } = useCreateSteps();
  const { mutateAsync: deleteManySteps } = useDeleteManySteps();
  const { mutateAsync: updateManyRepositoryCases, isPending: isDeleting } =
    useUpdateManyRepositoryCases();
  const { mutateAsync: updateSteps } = useUpdateSteps();
  const { mutateAsync: createRepositoryCaseVersions } =
    useCreateRepositoryCaseVersions();
  const { mutateAsync: createCaseFieldVersionValues } =
    useCreateCaseFieldVersionValues();

  // --- Memos and State Calculations ---

  // Determine if any selected case has steps
  useEffect(() => {
    if (casesData && casesData.length > 0) {
      const anyCaseHasSteps = casesData.some(
        (c) => c.steps && c.steps.length > 0
      );
      setHasSteps(anyCaseHasSteps);
    } else {
      setHasSteps(false);
    }
  }, [casesData]);

  // Determine template consistency and get template fields
  const { templateId, templateFields, hasMultipleTemplates } = useMemo(() => {
    if (!casesData || casesData.length === 0) {
      return {
        templateId: null,
        templateFields: [],
        hasMultipleTemplates: false,
      };
    }
    const firstTemplateId = casesData[0].templateId;
    const allSame = casesData.every((c) => c.templateId === firstTemplateId);
    if (!allSame) {
      return {
        templateId: null,
        templateFields: [],
        hasMultipleTemplates: true,
      };
    }
    // Ensure template and caseFields exist before accessing
    const fields =
      casesData[0].template?.caseFields
        ?.map((tf) => tf.caseField)
        .filter((cf): cf is NonNullable<typeof cf> => !!cf)
        .sort((a, b) => {
          // Sort based on the order defined in TemplateCaseAssignment
          const orderA =
            casesData[0].template?.caseFields.find(
              (tf) => tf.caseFieldId === a.id
            )?.order ?? 0;
          const orderB =
            casesData[0].template?.caseFields.find(
              (tf) => tf.caseFieldId === b.id
            )?.order ?? 0;
          return orderA - orderB;
        }) ?? [];
    return {
      templateId: firstTemplateId,
      templateFields: fields,
      hasMultipleTemplates: false,
    };
  }, [casesData]);

  // Determine if the common template includes a Steps field
  const templateHasStepsField = useMemo(() => {
    return (
      !hasMultipleTemplates &&
      templateFields.some((field) => field.type.type === "Steps")
    );
  }, [hasMultipleTemplates, templateFields]);

  // Update template warning state
  useEffect(() => {
    setShowTemplateWarning(hasMultipleTemplates);
  }, [hasMultipleTemplates]);

  const isAnyCaseJUnit = useMemo(() => {
    if (!casesData) return false;
    return casesData.some((testcase) => testcase.source === "JUNIT");
  }, [casesData]);

  // Define all possible fields (standard + custom if applicable)
  const allFieldDefinitions = useMemo((): FieldDefinition[] => {
    const standardFields: FieldDefinition[] = [
      { key: "name", label: tRepository("fields.name"), isCustom: false },
      { key: "state", label: tRepository("fields.state"), isCustom: false },
      {
        key: "automated",
        label: tRepository("fields.automated"),
        isCustom: false,
      },
      {
        key: "estimate",
        label: tRepository("fields.estimate"),
        isCustom: false,
      },
      { key: "tags", label: tRepository("fields.tags"), isCustom: false },
      { key: "issues", label: tCommon("fields.issues"), isCustom: false },
    ];

    if (hasMultipleTemplates || !templateFields) {
      return standardFields;
    }

    const customFields: FieldDefinition[] = templateFields.map((field) => ({
      key: `dynamic_${field.id}`,
      label: field.displayName,
      isCustom: true,
      field: field as FieldDefinition["field"],
    }));

    return [...standardFields, ...customFields];
  }, [tRepository, hasMultipleTemplates, templateFields, tCommon]);

  // --- Effects ---

  // Reset state when modal opens or selection changes
  useEffect(() => {
    if (isOpen) {
      setEditedFields({});
      setNewValues({});
      setFieldModes({});
      setSearchPatterns({});
      setReplacePatterns({});
      setSearchOptions({});
      setPreviewData({});
      setPreviewIndex({});
      // Resetting template warning is handled by the useMemo dependency
      // Refetch cases if selection changes while open
      if (selectedCaseIds.length > 0) {
        refetchCases();
      }
    } else {
      // Optional: Clear data when closed if needed
    }
  }, [isOpen, selectedCaseIds, refetchCases]);

  // --- Helper Functions ---

  // Check if a field supports search/replace
  const fieldSupportsSearchReplace = useCallback(
    (fieldKey: string): boolean => {
      if (fieldKey === "name") return true;

      const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);
      if (!fieldDef?.isCustom || !fieldDef.field) return false;

      const fieldType = fieldDef.field.type.type;
      return [
        "String",
        "Text",
        "Text String",
        "Text Long",
        "Link",
        "Steps",
      ].includes(fieldType);
    },
    [allFieldDefinitions]
  );

  // Extract text from field value based on field type
  const extractTextFromFieldValue = useCallback(
    (value: any, fieldKey: string): string => {
      if (value === null || value === undefined) return "";

      const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);
      if (!fieldDef?.isCustom || !fieldDef.field) {
        // Standard fields
        return String(value);
      }

      const fieldType = fieldDef.field.type.type;
      if (fieldType === "Text Long") {
        // Extract text from TipTap JSON
        try {
          const jsonContent =
            typeof value === "string" ? JSON.parse(value) : value;
          return extractTextFromNode(jsonContent);
        } catch {
          return String(value);
        }
      }

      if (fieldType === "Steps") {
        // For Steps, we don't extract text here as it's handled specially
        return "";
      }

      return String(value);
    },
    [allFieldDefinitions]
  );

  // Perform search/replace on text
  const performSearchReplace = useCallback(
    (
      text: string,
      searchPattern: string,
      replacePattern: string,
      options: SearchReplaceOptions
    ): { result: string; matchCount: number } => {
      if (!searchPattern) return { result: text, matchCount: 0 };

      let regex: RegExp;
      let matchCount = 0;

      try {
        if (options.useRegex) {
          const flags = options.caseSensitive ? "g" : "gi";
          regex = new RegExp(searchPattern, flags);
        } else {
          const escapedPattern = searchPattern.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );
          const flags = options.caseSensitive ? "g" : "gi";
          regex = new RegExp(escapedPattern, flags);
        }

        // Count matches
        const matches = text.match(regex);
        matchCount = matches ? matches.length : 0;

        // Perform replacement
        const result = text.replace(regex, replacePattern);
        return { result, matchCount };
      } catch (error) {
        // Invalid regex
        return { result: text, matchCount: 0 };
      }
    },
    []
  );

  // Apply search/replace to TipTap JSON structure
  const applySearchReplaceToTipTapJson = useCallback(
    (
      node: any,
      searchPattern: string,
      replacePattern: string,
      options: SearchReplaceOptions
    ): any => {
      if (!node) return node;

      // If node has text property, apply replacement
      if (node.text && typeof node.text === "string") {
        const { result } = performSearchReplace(
          node.text,
          searchPattern,
          replacePattern,
          options
        );
        return { ...node, text: result };
      }

      // If node has content array, recursively process
      if (node.content && Array.isArray(node.content)) {
        return {
          ...node,
          content: node.content.map((child: any) =>
            applySearchReplaceToTipTapJson(
              child,
              searchPattern,
              replacePattern,
              options
            )
          ),
        };
      }

      return node;
    },
    [performSearchReplace]
  );

  // Apply search/replace to field value
  const applySearchReplaceToFieldValue = useCallback(
    (
      value: any,
      fieldKey: string,
      searchPattern: string,
      replacePattern: string,
      options: SearchReplaceOptions
    ): any => {
      const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);

      if (!fieldDef?.isCustom || !fieldDef.field) {
        // Standard fields - simple string replacement
        const text = extractTextFromFieldValue(value, fieldKey);
        const { result } = performSearchReplace(
          text,
          searchPattern,
          replacePattern,
          options
        );
        return result;
      }

      const fieldType = fieldDef.field.type.type;

      if (fieldType === "Text Long") {
        // For rich text, we need to preserve formatting
        try {
          const jsonContent =
            typeof value === "string" ? JSON.parse(value) : value;
          const modifiedContent = applySearchReplaceToTipTapJson(
            jsonContent,
            searchPattern,
            replacePattern,
            options
          );
          return JSON.stringify(modifiedContent);
        } catch {
          // Fallback to simple text replacement
          const text = String(value);
          const { result } = performSearchReplace(
            text,
            searchPattern,
            replacePattern,
            options
          );
          return result;
        }
      }

      if (fieldType === "Steps") {
        // For Steps, return the value as-is since we handle it differently in save
        return value;
      }

      // For other text fields
      const text = extractTextFromFieldValue(value, fieldKey);
      const { result } = performSearchReplace(
        text,
        searchPattern,
        replacePattern,
        options
      );
      return result;
    },
    [
      allFieldDefinitions,
      extractTextFromFieldValue,
      performSearchReplace,
      applySearchReplaceToTipTapJson,
    ]
  );

  // Get the default value for a field
  const getFieldDefaultValue = useCallback(
    (fieldKey: string): any => {
      if (!workflowsData || !allFieldDefinitions) return null;

      if (fieldKey === "state") {
        // Find the default workflow marked in the DB if available
        const defaultWorkflow = workflowsData.find((w: any) => w.isDefault);
        return defaultWorkflow?.id ?? null;
      }
      if (fieldKey === "automated") return false;
      if (fieldKey === "estimate") return null;
      if (fieldKey === "tags") return [];
      if (fieldKey === "issues") return [];

      if (fieldKey.startsWith("dynamic_")) {
        const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);
        const defaultValueString = fieldDef?.field?.defaultValue;
        const fieldType = fieldDef?.field?.type?.type;

        if (defaultValueString === null || defaultValueString === undefined)
          return null;

        try {
          switch (fieldType) {
            case "Checkbox":
              return defaultValueString === "true";
            case "Date":
              return new Date(defaultValueString);
            case "Integer":
              return parseInt(defaultValueString, 10);
            case "Number":
              return parseFloat(defaultValueString);
            case "Multi-Select":
              try {
                return JSON.parse(defaultValueString);
              } catch {
                return defaultValueString
                  .split(",")
                  .map(Number)
                  .filter((n) => !isNaN(n));
              }
            case "Dropdown":
              return Number(defaultValueString);
            case "Text":
              return defaultValueString;
            case "String":
            case "Link":
            default:
              return defaultValueString;
          }
        } catch (error) {
          console.error(`Error parsing default value for ${fieldKey}:`, error);
          return null;
        }
      }
      return null;
    },
    [allFieldDefinitions, workflowsData]
  );

  // Get the value for a specific case and field key
  const getSingleCaseValue = useCallback(
    (caseItem: BulkEditCase, fieldKey: string): any => {
      if (fieldKey === "name") return caseItem.name;
      if (fieldKey === "state") return caseItem.stateId;
      if (fieldKey === "automated") return caseItem.automated;
      if (fieldKey === "estimate") return caseItem.estimate;
      if (fieldKey === "tags")
        return caseItem.tags.map((t) => t.id).sort((a, b) => a - b);
      if (fieldKey === "issues")
        return caseItem.issues.map((i) => i.id).sort((a, b) => a - b);
      if (fieldKey.startsWith("dynamic_")) {
        const fieldId = parseInt(fieldKey.split("_")[1], 10);
        const caseValue = caseItem.caseFieldValues.find(
          (cfv) => cfv.fieldId === fieldId
        )?.value;
        // Handle multi-select for comparison (return sorted array)
        if (Array.isArray(caseValue)) {
          return [...caseValue].sort();
        }
        return caseValue ?? null;
      }
      return undefined;
    },
    []
  );

  // Calculate the display value or placeholder for a field across all selected cases
  const getConsolidatedDisplayValue = useCallback(
    (fieldKey: string): any => {
      if (!casesData || casesData.length === 0) return "-";

      const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);
      if (!fieldDef) return "Unknown Field";

      const firstValue = getSingleCaseValue(casesData[0], fieldKey);
      const allSame = casesData
        .slice(1)
        .every((c) => isEqual(getSingleCaseValue(c, fieldKey), firstValue));

      if (!allSame) return VARIOUS_PLACEHOLDER;

      // Values are the same, format for display mimicking FieldValueRenderer
      if (fieldDef?.isCustom) {
        if (!fieldDef.field) return "-"; // Should have field definition for custom

        const fieldType = fieldDef.field.type.type;
        const fieldId = fieldDef.field.id;
        const template = casesData[0].template; // Template is consistent if allSame is true

        // Use FieldValueRenderer for display if value is not null/undefined AND NOT Steps
        if (
          fieldType !== "Steps" &&
          firstValue !== null &&
          firstValue !== undefined
        ) {
          return (
            <FieldValueRenderer
              fieldValue={firstValue}
              fieldType={fieldType}
              caseId="bulk-display" // Dummy caseId
              template={template}
              fieldId={fieldId}
              session={session}
              isEditMode={false}
              // Pass null/undefined for form props not needed in display mode
              isSubmitting={false}
              control={null}
              errors={null}
            />
          );
        } else {
          return "-"; // Display '-' for null/undefined consistent values
        }
      }

      // Handle Steps Display (if field type is Steps)
      else if (fieldDef.field?.type.type === "Steps") {
        // Assuming steps are never equal, always show <various> in view mode
        return VARIOUS_PLACEHOLDER;
      }

      // Keep direct rendering for standard fields for simplicity
      if (fieldKey === "name") {
        return String(firstValue) ?? "-";
      }
      if (fieldKey === "state") {
        const wf = workflowsData?.find((w) => w.id === firstValue);
        if (!wf) return firstValue ?? "-"; // Fallback if workflow not found
        return (
          <div className="flex items-center">
            {wf.icon && (
              <DynamicIcon
                className="shrink-0 mr-1 h-4 w-4"
                name={wf.icon.name as IconName}
                color={wf.color?.value}
              />
            )}
            {wf.name}
          </div>
        );
      } else if (fieldKey === "automated") {
        return <Switch checked={!!firstValue} disabled />;
      } else if (fieldKey === "estimate") {
        // Format numeric seconds value for display
        return typeof firstValue === "number" ? formatSeconds(firstValue) : "-";
      } else if (fieldKey === "tags") {
        if (!Array.isArray(firstValue) || firstValue.length === 0) return "-";
        return (
          firstValue
            .map(
              (tagId) => availableTagsData?.find((t) => t.id === tagId)?.name
            )
            .filter(Boolean)
            .join(", ") || "-"
        );
      } else if (fieldKey === "issues") {
        if (!Array.isArray(firstValue) || firstValue.length === 0) return "-";
        return (
          firstValue
            .map(
              (issueId) =>
                availableIssuesData?.find((i) => i.id === issueId)?.name
            )
            .filter(Boolean)
            .join(", ") || "-"
        );
      }

      return String(firstValue) ?? "-"; // Default display for unknown or null/undefined
    },
    [
      casesData,
      getSingleCaseValue,
      workflowsData,
      availableTagsData,
      availableIssuesData,
      allFieldDefinitions,
      session,
    ]
  ); // Added session to dependencies

  // Update preview data when search/replace patterns change
  const updatePreviewData = useCallback(
    (fieldKey: string) => {
      if (!casesData || fieldModes[fieldKey] !== "search-replace") return;

      const searchPattern = searchPatterns[fieldKey] || "";
      const replacePattern = replacePatterns[fieldKey] || "";
      const options = searchOptions[fieldKey] || {
        useRegex: false,
        caseSensitive: false,
      };

      const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);
      const isStepsField = fieldDef?.field?.type?.type === "Steps";

      const previews: PreviewMatch[] = [];

      for (const caseItem of casesData) {
        if (isStepsField) {
          // Handle Steps field specially
          const steps = caseItem.steps || [];
          let totalMatchCount = 0;
          const stepsPreview: PreviewMatch["stepsPreview"] = [];

          steps.forEach((step, index) => {
            let stepMatches = 0;
            let expectedResultMatches = 0;

            // Check step content
            if (step.step) {
              try {
                const stepJson =
                  typeof step.step === "string"
                    ? JSON.parse(step.step)
                    : step.step;
                const stepText = extractTextFromNode(stepJson);
                const { matchCount } = performSearchReplace(
                  stepText,
                  searchPattern,
                  replacePattern,
                  options
                );
                stepMatches = matchCount;
                totalMatchCount += matchCount;
              } catch {}
            }

            // Check expected result content
            if (step.expectedResult) {
              try {
                const expectedJson =
                  typeof step.expectedResult === "string"
                    ? JSON.parse(step.expectedResult)
                    : step.expectedResult;
                const expectedText = extractTextFromNode(expectedJson);
                const { matchCount } = performSearchReplace(
                  expectedText,
                  searchPattern,
                  replacePattern,
                  options
                );
                expectedResultMatches = matchCount;
                totalMatchCount += matchCount;
              } catch {}
            }

            if (stepMatches > 0 || expectedResultMatches > 0) {
              stepsPreview.push({
                stepNumber: index + 1,
                stepMatches,
                expectedResultMatches,
              });
            }
          });

          if (totalMatchCount > 0) {
            previews.push({
              caseId: caseItem.id,
              caseName: caseItem.name,
              originalValue: "",
              newValue: "",
              matchCount: totalMatchCount,
              stepsPreview,
            });
          }
        } else {
          // Handle other fields normally
          const originalValue = getSingleCaseValue(caseItem, fieldKey);
          const text = extractTextFromFieldValue(originalValue, fieldKey);
          const { result, matchCount } = performSearchReplace(
            text,
            searchPattern,
            replacePattern,
            options
          );

          if (matchCount > 0) {
            previews.push({
              caseId: caseItem.id,
              caseName: caseItem.name,
              originalValue: text,
              newValue: result,
              matchCount,
            });
          }
        }
      }

      setPreviewData((prev) => ({ ...prev, [fieldKey]: previews }));
      setPreviewIndex((prev) => ({ ...prev, [fieldKey]: 0 }));
    },
    [
      casesData,
      fieldModes,
      searchPatterns,
      replacePatterns,
      searchOptions,
      getSingleCaseValue,
      extractTextFromFieldValue,
      performSearchReplace,
      allFieldDefinitions,
    ]
  );

  // Update preview when search patterns change
  useEffect(() => {
    Object.keys(fieldModes).forEach((fieldKey) => {
      if (fieldModes[fieldKey] === "search-replace") {
        updatePreviewData(fieldKey);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Only include the state values, not the callback function
    fieldModes,
    searchPatterns,
    replacePatterns,
    searchOptions,
    // Note: updatePreviewData is intentionally excluded to prevent infinite loops
  ]);

  // --- Validation Logic ---

  const validateEditedFields = (
    editedFields: Record<string, boolean>,
    newValues: Record<string, any>,
    allFieldDefinitions: FieldDefinition[]
  ): Record<string, string[]> => {
    const errors: Record<string, string[]> = {};

    for (const fieldKey in editedFields) {
      if (!editedFields[fieldKey]) continue; // Skip fields not being edited

      // Special validation for search/replace mode
      if (fieldModes[fieldKey] === "search-replace") {
        const searchPattern = searchPatterns[fieldKey] || "";
        const options = searchOptions[fieldKey] || {
          useRegex: false,
          caseSensitive: false,
        };

        // Validate regex pattern if using regex
        if (options.useRegex && searchPattern) {
          try {
            new RegExp(searchPattern);
          } catch (e) {
            errors[fieldKey] = [tBulkEdit("invalidRegexPattern")];
            continue;
          }
        }

        // Check if search pattern is empty
        if (!searchPattern) {
          errors[fieldKey] = [tBulkEdit("searchPatternRequired")];
          continue;
        }

        // Skip normal validation for search/replace mode
        continue;
      }

      const value = newValues[fieldKey];
      const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);
      if (!fieldDef) continue; // Should not happen if data is consistent

      let schema: z.ZodTypeAny = z.any(); // Initialize schema
      const isRequired = fieldDef.isCustom
        ? (fieldDef.field?.isRequired ?? false)
        : false; // Standard fields aren't typically marked required here

      // --- Create Zod Schema Snippet based on Field Type --- //

      if (fieldKey === "name") {
        schema = z
          .string()
          .nullable()
          .refine(
            (val) => val !== null && val !== undefined && val.trim().length > 0,
            {
              message: t("common.fields.validation.nameRequired"),
            }
          );
      } else if (fieldKey === "state") {
        schema = z
          .number()
          .nullable()
          .refine((val) => val !== null && val !== undefined && val > 0, {
            message: t("common.fields.validation.stateRequired"),
          });
      } else if (fieldKey === "automated") {
        schema = z.boolean();
      } else if (fieldKey === "estimate") {
        schema = z
          .string()
          .nullable()
          .refine(
            (val) => {
              if (val === null || val === "" || val === undefined)
                return !isRequired; // Valid if not required and empty
              const durationMs = parseDuration(val);
              if (durationMs === null) return false; // Invalid format
              const durationSec = Math.round(durationMs / 1000);
              return durationSec <= MAX_DURATION; // Check max duration
            },
            {
              message: isRequired
                ? "Estimate is required and must be a valid duration (e.g., 1h 30m)"
                : "Invalid duration format or exceeds maximum limit (e.g., 1h 30m)",
            }
          );
      } else if (fieldKey === "tags") {
        let tagsSchema = z.array(z.number());
        if (isRequired)
          tagsSchema = tagsSchema.min(1, {
            message: "At least one tag is required",
          });
        schema = isRequired ? tagsSchema : tagsSchema.nullable(); // Apply nullability correctly
      } else if (fieldKey === "issues") {
        let issuesSchema = z.array(z.number());
        if (isRequired)
          issuesSchema = issuesSchema.min(1, {
            message: "At least one issue is required",
          });
        schema = isRequired ? issuesSchema : issuesSchema.nullable();
      } else if (fieldDef.isCustom && fieldDef.field) {
        const fieldType = fieldDef.field.type.type;
        const minValue = fieldDef.field.minValue;
        const maxValue = fieldDef.field.maxValue;

        switch (fieldType) {
          case "Checkbox":
            schema = z.boolean();
            // Required for checkbox doesn't make much sense unless it must be true
            break;
          case "Date":
            const dateSchema = z.date();
            schema = isRequired ? dateSchema : dateSchema.nullable();
            break;
          case "Multi-Select":
            let multiSchema = z.array(z.number());
            if (isRequired)
              multiSchema = multiSchema.min(1, {
                message: "At least one option must be selected",
              });
            schema = isRequired ? multiSchema : multiSchema.nullable();
            break;
          case "Dropdown":
            const dropSchema = z.number();
            schema = isRequired ? dropSchema : dropSchema.nullable();
            break;
          case "Integer":
            let intSchema = z.int();
            if (minValue !== null) intSchema = intSchema.min(minValue);
            if (maxValue !== null) intSchema = intSchema.max(maxValue);
            schema = isRequired ? intSchema : intSchema.nullable();
            break;
          case "Number":
            let numSchema = z.number();
            if (minValue !== null) numSchema = numSchema.min(minValue);
            if (maxValue !== null) numSchema = numSchema.max(maxValue);
            schema = isRequired ? numSchema : numSchema.nullable();
            break;
          case "Link":
            if (isRequired) {
              // If required, it must be a non-empty valid URL
              schema = z
                .url()
                .min(1, { message: t("common.fields.validation.urlRequired") });
            } else {
              // If not required, allow null, undefined, empty string, or a valid URL
              schema = z.union([z.url(), z.literal("")]).nullable();
            }
            break;
          case "String": // String field type
          case "Text String": // Text String field type
            let strSchema = z.string();
            if (isRequired)
              strSchema = strSchema.min(1, { message: "Value is required" });
            schema = strSchema.nullable(); // Allow null/empty string if not required
            break;
          case "Text Long":
            // Start with string, apply nullability/parsing later
            let textSchema: z.ZodTypeAny = z.string();

            if (isRequired) {
              textSchema = textSchema.refine(
                (val) => {
                  if (!val) return false;
                  try {
                    return (
                      JSON.stringify(JSON.parse(val as string)) !==
                      JSON.stringify(emptyEditorContent)
                    );
                  } catch {
                    return false;
                  } // Invalid JSON doesn't satisfy required
                },
                { message: "Content is required" }
              );
              // If required, it must be a non-empty, valid JSON string.
              // Nullable is handled separately.
            } else {
              // If not required, allow null/undefined, OR valid JSON string (can be empty)
              schema = z
                .string()
                .refine(
                  (val) => {
                    if (val === null || val === undefined) return true; // Null/undefined is ok
                    try {
                      JSON.parse(val as string);
                      return true;
                    } catch {
                      return false; // Invalid JSON is not ok
                    }
                  },
                  {
                    message: "Invalid content format",
                  }
                )
                .nullable();
            }
            break;
          // case "Steps": // Validation might be too complex here
          //   schema = z.any();
          //   break;
          default:
            schema = z.any(); // Default for unknown types
        }
      } else {
        schema = z.any(); // Fallback if not custom or fieldDef missing
      }

      // --- Perform Validation --- //
      const result = schema.safeParse(value);
      if (!result.success) {
        errors[fieldKey] = result.error.issues.map((issue) => issue.message);
      }
    }

    return errors;
  };

  // --- Event Handlers ---

  const handleFieldEditToggle = (fieldKey: string, isChecked: boolean) => {
    setEditedFields((prev) => ({ ...prev, [fieldKey]: isChecked }));

    if (isChecked) {
      // Set default mode based on field type
      const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);
      const isStepsField = fieldDef?.field?.type?.type === "Steps";
      const supportsSearchReplace = fieldSupportsSearchReplace(fieldKey);
      if (supportsSearchReplace) {
        setFieldModes((prev) => ({
          ...prev,
          [fieldKey]: isStepsField ? "search-replace" : "replace",
        }));
      }

      // Initialize search options
      setSearchOptions((prev) => ({
        ...prev,
        [fieldKey]: { useRegex: false, caseSensitive: false },
      }));

      // Entering edit mode: set initial value
      const consolidatedValue = getConsolidatedDisplayValue(fieldKey);
      if (consolidatedValue === VARIOUS_PLACEHOLDER) {
        // Values are different, set the default value (or null/empty for estimate)
        const defaultValue =
          fieldKey === "estimate" ? "" : getFieldDefaultValue(fieldKey);
        handleValueChange(fieldKey, defaultValue);
      } else {
        // Values are the same, set the common value
        const commonValue = casesData
          ? getSingleCaseValue(casesData[0], fieldKey)
          : null;
        // Format estimate value if it's a number (seconds)
        const initialEditValue =
          fieldKey === "estimate" && typeof commonValue === "number"
            ? formatSeconds(commonValue)
            : commonValue;
        handleValueChange(fieldKey, initialEditValue);
      }
    } else {
      // Remove values and states if unchecking
      setNewValues((prev) => {
        const { [fieldKey]: _, ...rest } = prev;
        return rest;
      });
      setFieldModes((prev) => {
        const { [fieldKey]: _, ...rest } = prev;
        return rest;
      });
      setSearchPatterns((prev) => {
        const { [fieldKey]: _, ...rest } = prev;
        return rest;
      });
      setReplacePatterns((prev) => {
        const { [fieldKey]: _, ...rest } = prev;
        return rest;
      });
      setSearchOptions((prev) => {
        const { [fieldKey]: _, ...rest } = prev;
        return rest;
      });
      setPreviewData((prev) => {
        const { [fieldKey]: _, ...rest } = prev;
        return rest;
      });
      setPreviewIndex((prev) => {
        const { [fieldKey]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleValueChange = (fieldKey: string, value: any) => {
    setNewValues((prev) => ({ ...prev, [fieldKey]: value }));
  };

  const handleSave = async () => {
    // Reset inline errors
    setInlineErrors({});

    // Validate edited fields first
    const validationErrors = validateEditedFields(
      editedFields,
      newValues,
      allFieldDefinitions
    );

    if (Object.keys(validationErrors).length > 0) {
      setInlineErrors(validationErrors);
      toast.error(tBulkEdit("validationError"));
      return; // Stop saving if validation fails
    }

    // Ensure casesData is loaded before proceeding
    if (!casesData) {
      toast.error("Failed to load case data. Cannot save.");
      return;
    }

    const caseIdsToUpdate = casesData.map((c) => c.id);

    setIsSaving(true);
    try {
      // Build the request payload for the bulk edit API
      const payload: any = {
        caseIds: caseIdsToUpdate,
        updates: {},
        createVersions: true,
      };

      // Process standard fields
      for (const [fieldKey, isEditing] of Object.entries(editedFields)) {
        if (!isEditing) continue;

        const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);
        if (!fieldDef) continue;

        // Skip custom fields and steps - handle them separately
        if (fieldKey.startsWith("dynamic_") || fieldDef.field?.type.type === "Steps") {
          continue;
        }

        let newValue = newValues[fieldKey];

        // Handle search/replace mode for standard fields
        if (fieldModes[fieldKey] === "search-replace") {
          // Search/replace for standard fields is complex - skip for now
          // The API doesn't support search/replace for standard fields yet
          continue;
        }

        // Build updates based on field type
        if (fieldKey === "state" && newValue) {
          payload.updates.state = Number(newValue);
        } else if (fieldKey === "name") {
          payload.updates.name = newValue as string;
        } else if (fieldKey === "automated") {
          payload.updates.automated = !!newValue;
        } else if (fieldKey === "estimate") {
          const durationMs = parseDuration((newValue as string) ?? "");
          const estimateInSeconds =
            durationMs !== null ? Math.round(durationMs / 1000) : null;
          payload.updates.estimate = estimateInSeconds;
        } else if (fieldKey === "tags") {
          // Get all unique tag IDs from all cases
          const allCurrentTagIds = new Set<number>();
          casesData.forEach((c) => {
            c.tags.forEach((t) => allCurrentTagIds.add(t.id));
          });

          const newTagIds = Array.isArray(newValue) ? newValue.map(Number) : [];

          // For bulk operations, we connect new tags and don't disconnect
          // This is because different cases may have different current tags
          const tagsToConnect = newTagIds.filter(id => !allCurrentTagIds.has(id)).map(id => ({ id }));

          if (newTagIds.length > 0) {
            payload.updates.tags = {
              connect: tagsToConnect.length > 0 ? tagsToConnect : [],
            };
          }
        } else if (fieldKey === "issues") {
          // Similar logic to tags
          const allCurrentIssueIds = new Set<number>();
          casesData.forEach((c) => {
            (c.issues || []).forEach((i) => allCurrentIssueIds.add(i.id));
          });

          const newIssueIds = Array.isArray(newValue) ? newValue.map(Number) : [];

          const issuesToConnect = newIssueIds.filter(id => !allCurrentIssueIds.has(id)).map(id => ({ id }));

          if (newIssueIds.length > 0) {
            payload.updates.issues = {
              connect: issuesToConnect.length > 0 ? issuesToConnect : [],
            };
          }
        }
      }

      // Handle custom fields
      const customFieldUpdates: any[] = [];
      for (const [fieldKey, isEditing] of Object.entries(editedFields)) {
        if (!isEditing || !fieldKey.startsWith("dynamic_")) continue;

        const fieldId = parseInt(fieldKey.split("_")[1], 10);
        const fieldDef = allFieldDefinitions.find((f) => f.key === fieldKey);
        const fieldType = fieldDef?.field?.type.type;
        let newValue = newValues[fieldKey];

        // Skip search/replace for custom fields - handle differently per case
        if (fieldModes[fieldKey] === "search-replace") {
          continue;
        }

        // Determine the value to set
        let valueToSet: any;
        if (newValue === null || newValue === undefined) {
          valueToSet = null;
        } else if (fieldType === "Link") {
          valueToSet = newValue === "" ? "" : newValue;
        } else if (fieldType === "Multi-Select") {
          valueToSet = Array.isArray(newValue) ? newValue : [];
        } else if (newValue === "") {
          valueToSet = null;
        } else {
          valueToSet = newValue;
        }

        // For bulk operations, we update or create for each case
        // The API will handle checking existence
        customFieldUpdates.push({
          fieldId,
          value: valueToSet,
          operation: "update", // API will handle create vs update
        });
      }

      if (customFieldUpdates.length > 0) {
        payload.customFieldUpdates = customFieldUpdates;
      }

      // Handle steps
      const stepsFieldKey = allFieldDefinitions.find(
        (def) => def.field?.type.type === "Steps"
      )?.key;

      if (stepsFieldKey && editedFields[stepsFieldKey]) {
        const isStepsSearchReplace =
          fieldModes[stepsFieldKey] === "search-replace";

        if (isStepsSearchReplace) {
          payload.stepsUpdates = {
            operation: "search-replace",
            searchPattern: searchPatterns[stepsFieldKey] || "",
            replacePattern: replacePatterns[stepsFieldKey] || "",
            searchOptions: searchOptions[stepsFieldKey] || {
              useRegex: false,
              caseSensitive: false,
            },
          };
        } else {
          // Replace mode
          const newStepsData = newValues[stepsFieldKey];
          if (Array.isArray(newStepsData)) {
            payload.stepsUpdates = {
              operation: "replace",
              newSteps: newStepsData.map((stepData: any, index: number) => ({
                step: stepData.step || emptyEditorContent,
                expectedResult: stepData.expectedResult || emptyEditorContent,
                order: index,
              })),
            };
          }
        }
      }

      // Call the bulk edit API
      const response = await fetch(
        `/api/projects/${projectId}/cases/bulk-edit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to perform bulk edit");
      }

      await response.json(); // Parse response to ensure no errors

      toast.success(
        tBulkEdit("success.casesUpdated", { count: caseIdsToUpdate.length })
      );
      onSaveSuccess(); // Trigger refetch in parent
      onClose();
    } catch (error: any) {
      console.error("Failed to save bulk edits:", error);
      toast.error(error.message || tCommon("errors.unknown"));
    } finally {
      setIsSaving(false);
    }
  };

  // --- Delete Handler ---
  const handleBulkDelete = async () => {
    if (!selectedCaseIds.length) return;
    try {
      await updateManyRepositoryCases({
        data: { isDeleted: true },
        where: { id: { in: selectedCaseIds } },
      });
      // Use bracket notation to avoid linter error
      const deletedMsgFn = (tBulkEdit as any)["success.casesDeleted"];
      const deletedMsg =
        typeof deletedMsgFn === "function"
          ? deletedMsgFn({ count: selectedCaseIds.length })
          : undefined;
      toast.success(
        deletedMsg && typeof deletedMsg === "string"
          ? deletedMsg
          : `Deleted ${selectedCaseIds.length} cases.`
      );
      setDeletePopoverOpen(false);
      onSaveSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || tCommon("errors.unknown"));
    }
  };

  // --- Render Logic ---

  // Determine if any field is checked for editing
  const isAnyFieldEditing = Object.values(editedFields).some(
    (isEditing) => isEditing
  );

  const renderFieldInput = (field: FieldDefinition, fieldKey: string) => {
    // Check if the field is restricted (only applies to custom fields)
    const isRestricted = field.isCustom
      ? (field.field?.isRestricted ?? false)
      : false;

    const isStepsField = field.field?.type?.type === "Steps";
    const mode = isStepsField
      ? "search-replace"
      : fieldModes[fieldKey] || "replace";
    const supportsSearchReplace = fieldSupportsSearchReplace(fieldKey);

    if (mode === "search-replace" && supportsSearchReplace) {
      const options = searchOptions[fieldKey] || {
        useRegex: false,
        caseSensitive: false,
      };
      const previews = previewData[fieldKey] || [];
      const currentPreviewIndex = previewIndex[fieldKey] || 0;
      const currentPreview = previews[currentPreviewIndex];

      return (
        <div className="space-y-4">
          {/* Mode selector - hide for Steps field as it only supports search/replace */}
          {!isStepsField && (
            <RadioGroup
              value={mode}
              onValueChange={(value) =>
                setFieldModes((prev) => ({
                  ...prev,
                  [fieldKey]: value as FieldEditMode,
                }))
              }
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="replace" id={`${fieldKey}-replace`} />
                <Label htmlFor={`${fieldKey}-replace`}>
                  {tBulkEdit("replaceAll")}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="search-replace"
                  id={`${fieldKey}-search-replace`}
                />
                <Label htmlFor={`${fieldKey}-search-replace`}>
                  {tBulkEdit("searchReplace")}
                </Label>
              </div>
            </RadioGroup>
          )}

          {/* Steps field info */}
          {isStepsField && (
            <Alert variant="default" className="mb-4">
              <Info className="h-4 w-4" />
              <AlertDescription>
                {tBulkEdit("stepsSearchReplaceInfo")}
              </AlertDescription>
            </Alert>
          )}

          {/* Search/Replace inputs */}
          <div className="space-y-2">
            <div>
              <Label className="text-xs">{tBulkEdit("searchFor")}</Label>
              <Input
                value={searchPatterns[fieldKey] || ""}
                onChange={(e) =>
                  setSearchPatterns((prev) => ({
                    ...prev,
                    [fieldKey]: e.target.value,
                  }))
                }
                placeholder={
                  options.useRegex ? "e.g., test\\d+" : tBulkEdit("searchText")
                }
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">{tBulkEdit("replaceWith")}</Label>
              <Input
                value={replacePatterns[fieldKey] || ""}
                onChange={(e) =>
                  setReplacePatterns((prev) => ({
                    ...prev,
                    [fieldKey]: e.target.value,
                  }))
                }
                placeholder={
                  options.useRegex
                    ? "e.g., test$1"
                    : tBulkEdit("replacementText")
                }
                className="h-9"
              />
            </div>
          </div>

          {/* Options */}
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`${fieldKey}-regex`}
                checked={options.useRegex}
                onCheckedChange={(checked) =>
                  setSearchOptions((prev) => ({
                    ...prev,
                    [fieldKey]: { ...options, useRegex: !!checked },
                  }))
                }
              />
              <Label htmlFor={`${fieldKey}-regex`} className="text-sm">
                {tBulkEdit("useRegex")}
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`${fieldKey}-case`}
                checked={options.caseSensitive}
                onCheckedChange={(checked) =>
                  setSearchOptions((prev) => ({
                    ...prev,
                    [fieldKey]: { ...options, caseSensitive: !!checked },
                  }))
                }
              />
              <Label htmlFor={`${fieldKey}-case`} className="text-sm">
                {tBulkEdit("caseSensitive")}
              </Label>
            </div>
          </div>

          {/* Regex hint */}
          {options.useRegex && (
            <p className="text-xs text-muted-foreground">
              {tBulkEdit("regexHint")}
            </p>
          )}

          {/* Preview */}
          {previews.length > 0 && (
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  {tBulkEdit("preview")} {"("}
                  {previews.length} {tBulkEdit("matches")}
                  {")"}
                </span>
                {previews.length > 1 && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPreviewIndex((prev) => ({
                          ...prev,
                          [fieldKey]: Math.max(0, currentPreviewIndex - 1),
                        }))
                      }
                      disabled={currentPreviewIndex === 0}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm px-2">
                      {currentPreviewIndex + 1} / {previews.length}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPreviewIndex((prev) => ({
                          ...prev,
                          [fieldKey]: Math.min(
                            previews.length - 1,
                            currentPreviewIndex + 1
                          ),
                        }))
                      }
                      disabled={currentPreviewIndex >= previews.length - 1}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              {currentPreview && (
                <div className="space-y-1 text-sm">
                  <div className="font-medium">{currentPreview.caseName}</div>
                  {isStepsField && currentPreview.stepsPreview ? (
                    <div className="space-y-2">
                      {currentPreview.stepsPreview.map((stepPreview) => (
                        <div
                          key={stepPreview.stepNumber}
                          className="pl-2 border-l-2 border-muted"
                        >
                          <div className="font-medium text-xs text-muted-foreground">
                            {t("common.ui.step") + " "}
                            {stepPreview.stepNumber}
                          </div>
                          {stepPreview.stepMatches > 0 && (
                            <div className="text-xs">
                              {stepPreview.stepMatches}{" "}
                              {stepPreview.stepMatches === 1
                                ? "match"
                                : "matches"}
                              {" in step description"}
                            </div>
                          )}
                          {stepPreview.expectedResultMatches > 0 && (
                            <div className="text-xs">
                              {stepPreview.expectedResultMatches}{" "}
                              {stepPreview.expectedResultMatches === 1
                                ? "match"
                                : "matches"}
                              {" in expected result"}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="text-muted-foreground">
                        <span className="line-through">
                          {currentPreview.originalValue}
                        </span>
                      </div>
                      <div className="text-foreground">
                        {currentPreview.newValue}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {searchPatterns[fieldKey] && previews.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {tBulkEdit("noMatches")}
            </p>
          )}
        </div>
      );
    }

    // Regular replace mode
    return (
      <div className="space-y-2">
        {supportsSearchReplace && !isStepsField && (
          <RadioGroup
            value={mode}
            onValueChange={(value) =>
              setFieldModes((prev) => ({
                ...prev,
                [fieldKey]: value as FieldEditMode,
              }))
            }
            className="flex gap-4 mb-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="replace" id={`${fieldKey}-replace`} />
              <Label htmlFor={`${fieldKey}-replace`}>
                {tBulkEdit("replaceAll")}
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem
                value="search-replace"
                id={`${fieldKey}-search-replace`}
              />
              <Label htmlFor={`${fieldKey}-search-replace`}>
                {tBulkEdit("searchReplace")}
              </Label>
            </div>
          </RadioGroup>
        )}

        <FieldValueInput
          fieldDefinition={field.field} // Pass the detailed field info if custom
          fieldKey={fieldKey} // Pass standard key ('state', 'automated', etc.) or custom key ('dynamic_123')
          value={newValues[fieldKey] ?? null} // Pass current value from state
          onChange={(value: any) => handleValueChange(fieldKey, value)}
          projectId={projectId}
          workflowsData={workflowsData}
          availableTagsData={availableTagsData}
          availableIssuesData={availableIssuesData}
          canCreateTags={canCreateTagsPerm} // Pass the permission prop
          canEditRestricted={canEditRestrictedPerm} // Pass general permission
          fieldIsRestricted={isRestricted} // Pass specific field restriction
          // Pass any other necessary props like options for dropdowns
        />
      </div>
    );
  };

  const isLoading =
    isLoadingCases ||
    isLoadingWorkflows ||
    isLoadingTags ||
    isLoadingAvailableIssues ||
    isLoadingTagsPermissions ||
    isLoadingRestrictedPermissions ||
    isDeleting;
  const hasFetchError = !!casesError;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {tBulkEdit("title", { count: selectedCaseIds.length })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {tBulkEdit("title", { count: selectedCaseIds.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="grow overflow-y-auto pr-6 pl-2 py-4 space-y-4">
          {isLoading && (
            <div className="flex justify-center items-center h-40">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {hasFetchError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{tCommon("errors.error")}</AlertTitle>
              <AlertDescription>
                {casesError?.message || tCommon("errors.unknown")}
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !hasFetchError && casesData && (
            <>
              {showTemplateWarning && (
                <Alert variant="default">
                  <Info className="h-4 w-4" />
                  <AlertTitle className="font-bold">
                    {tBulkEdit("warnings.templateMismatch.title")}
                  </AlertTitle>
                  <AlertDescription>
                    {tBulkEdit("warnings.templateMismatch.description")}
                  </AlertDescription>
                </Alert>
              )}

              {isAnyCaseJUnit && (
                <Alert variant="default" className="mt-4">
                  <Info className="h-4 w-4" />
                  <AlertTitle className="font-bold">
                    {tBulkEdit("warnings.junitLimitations.title")}
                  </AlertTitle>
                  <AlertDescription>
                    {tBulkEdit("warnings.junitLimitations.description")}
                  </AlertDescription>
                </Alert>
              )}

              {allFieldDefinitions.map((field) => {
                const fieldKey = field.key;
                const isEditing = editedFields[fieldKey] || false;
                const displayValue = getConsolidatedDisplayValue(fieldKey);

                return (
                  <div
                    key={fieldKey}
                    className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1"
                  >
                    {/* Checkbox + Label */}
                    <div className="flex items-center space-x-2 pt-1 justify-self-start">
                      <Checkbox
                        id={`edit-${fieldKey}`}
                        checked={isEditing}
                        onCheckedChange={(checked) =>
                          handleFieldEditToggle(fieldKey, !!checked)
                        }
                        disabled={
                          isAnyCaseJUnit &&
                          (fieldKey === "estimate" || fieldKey === "automated")
                        }
                      />
                      <Label
                        htmlFor={`edit-${fieldKey}`}
                        className="font-semibold text-sm flex items-center"
                      >
                        {field.label}
                        {!field.isCustom && (
                          <HelpPopover helpKey={`bulkEdit.${fieldKey}`} />
                        )}
                        {field.isCustom && field.field?.hint && (
                          <HelpPopover
                            helpKey={`## ${field.field.displayName}\n\n${field.field.hint}`}
                          />
                        )}
                        {field.isCustom && field.field?.isRestricted && (
                          <span
                            title="Restricted Field"
                            className="ml-1 text-muted-foreground"
                          >
                            <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                          </span>
                        )}
                      </Label>
                    </div>

                    {/* Value Display or Input */}
                    <div className="min-h-10">
                      {isEditing ? (
                        <>
                          {renderFieldInput(field, fieldKey)}
                          {/* Display inline error if exists */}
                          {inlineErrors[fieldKey] && (
                            <p className="text-sm font-medium text-destructive mt-1">
                              {inlineErrors[fieldKey][0]}{" "}
                              {/* Show first error */}
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                          {displayValue === VARIOUS_PLACEHOLDER ? (
                            <span className="italic text-muted-foreground/80">
                              {VARIOUS_PLACEHOLDER}
                            </span>
                          ) : (
                            // displayValue can now be a JSX element
                            displayValue
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <DialogFooter className="flex justify-between items-center w-full">
          {/* Left: Delete button */}
          <div>
            <Popover
              open={deletePopoverOpen}
              onOpenChange={setDeletePopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={
                    isLoading || isUpdating || isDeleting || hasFetchError || isSaving
                  }
                >
                  <Trash2 className="h-5 w-5" />
                  {tCommon("actions.delete")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-fit max-w-sm" side="top">
                {tBulkEdit("confirmDeleteCases", {
                  count: selectedCaseIds.length,
                })}
                <div className="flex items-start justify-end gap-4 mt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setDeletePopoverOpen(false)}
                    disabled={isDeleting}
                  >
                    <CircleSlash2 className="h-4 w-4" />
                    {tCommon("actions.cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleBulkDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting && (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    )}
                    <Trash2 className="h-4 w-4" />
                    {tCommon("actions.delete")}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          {/* Right: Cancel and Save */}
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
                {tCommon("actions.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={handleSave}
              disabled={
                isUpdating || isLoading || hasFetchError || !isAnyFieldEditing || isSaving
              }
            >
              {(isUpdating || isSaving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon("actions.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
