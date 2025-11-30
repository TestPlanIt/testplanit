"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import {
  CaseFields as PrismaCaseField,
  Tags as PrismaTag,
  Workflows as PrismaWorkflow,
  Issue as PrismaIssue,
} from "@prisma/client";
import { useTranslations, useLocale } from "next-intl";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { Label } from "@/components/ui/label";
import { ManageTags } from "@/components/ManageTags";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { getDateFnsLocale } from "~/utils/locales";
import { cn } from "~/utils";
import { formatSeconds } from "@/components/DurationDisplay";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import StepsForm from "./StepsForm";
import { FormProvider, useForm } from "react-hook-form";
import { useSession } from "next-auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";

interface FieldValueInputProps {
  fieldDefinition?: FieldDefinition["field"];
  fieldKey: string; // Unique key ('state', 'automated', 'dynamic_123')
  value: any;
  onChange: (value: any) => void;
  projectId: number;
  workflowsData?: (Pick<PrismaWorkflow, "id" | "name"> & {
    icon?: { name: string } | null;
    color?: { value: string } | null;
  })[]; // Correct shape based on schema
  availableTagsData?: Pick<PrismaTag, "id" | "name">[];
  canCreateTags?: boolean; // Add permission prop
  availableIssuesData?: Pick<PrismaIssue, "id" | "name" | "externalId">[];
  canEditRestricted?: boolean; // Add prop
  fieldIsRestricted?: boolean; // Add prop
  // Add other necessary props like template info if needed for complex types
}

// Reusing the FieldDefinition structure slightly modified
interface FieldDefinition {
  key: string;
  label: string;
  isCustom: boolean;
  field?: PrismaCaseField & { type: { type: string }; fieldOptions?: any[] };
}

// Define the expected shape for a step
type Step = {
  type: string;
  content: string;
};

// Define a simple schema for the steps form within FieldValueInput
// It needs a key matching the fieldKey for useFieldArray
const createStepsSchema = (fieldKey: string) =>
  z.object({
    [fieldKey]: z.array(
      z.object({
        id: z.string().optional(), // Optional if step is new
        step: z.any(), // Using any for TipTap JSON content
        expectedResult: z.any(), // Using any for TipTap JSON content
      })
    ),
  });

export function FieldValueInput({
  fieldDefinition,
  fieldKey,
  value,
  onChange,
  projectId,
  workflowsData = [],
  availableTagsData = [],
  canCreateTags = false, // Default to false
  availableIssuesData = [], // Added default for issues
  canEditRestricted = true, // Default to true
  fieldIsRestricted = false, // Default to false
}: FieldValueInputProps) {
  // Define translations with correct namespaces
  const t = useTranslations(); // Default for potentially unique keys
  const commonT = useTranslations("common");
  const repositoryT = useTranslations("repository");
  const bulkEditT = useTranslations("repository.bulkEdit"); // Specific bulk edit keys
  const locale = useLocale(); // Get locale for date formatting
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false); // State for date picker popover
  const [isStepsDialogOpen, setIsStepsDialogOpen] = useState(false);
  const { data: session } = useSession();
  const userPreferences = session?.user.preferences;

  // Create a schema dynamically based on the fieldKey
  const stepsSchema = createStepsSchema(fieldKey);

  // Initialize form methods specifically for the steps dialog
  const stepsFormMethods = useForm({
    resolver: zodResolver(stepsSchema),
    defaultValues: {
      [fieldKey]: [], // Initialize with an empty array under the dynamic key
    },
  });

  // Effect to reset the steps form when the dialog opens
  useEffect(() => {
    if (isStepsDialogOpen) {
      // If value is an array (existing steps), reset form with those steps.
      // Otherwise, reset with an empty array (new steps).
      const initialSteps = Array.isArray(value) ? value : [];
      stepsFormMethods.reset({ [fieldKey]: initialSteps });
    }
    // Dependencies: dialog state, current value, form methods, and the field key
  }, [isStepsDialogOpen, value, stepsFormMethods, fieldKey]);

  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });

  const fieldType = fieldDefinition?.type.type;

  // Determine if the input should be disabled
  const isDisabled = fieldIsRestricted && !canEditRestricted;

  // --- Standard Fields ---
  if (fieldKey === "name") {
    return (
      <Input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={repositoryT("fields.name")}
        disabled={isDisabled}
      />
    );
  }

  if (fieldKey === "state") {
    const workflowOptions =
      workflowsData?.map((workflow) => ({
        value: workflow.id.toString(),
        label: (
          <div className="flex items-center">
            {workflow.icon && (
              <DynamicIcon
                className="shrink-0 mr-1 h-4 w-4"
                name={workflow.icon.name as IconName}
                color={workflow.color?.value}
              />
            )}
            {workflow.name}
          </div>
        ),
      })) || [];
    return (
      <Select
        value={value ? value.toString() : ""}
        onValueChange={(val) => onChange(Number(val))}
        disabled={isDisabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={commonT("placeholders.select")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {workflowOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }

  if (fieldKey === "automated") {
    return (
      <div className="flex items-center space-x-2 h-10">
        <Switch
          id={`switch-${fieldKey}`}
          checked={value === null ? false : Boolean(value)}
          onCheckedChange={onChange}
          disabled={isDisabled}
        />
        <Label htmlFor={`switch-${fieldKey}`}>
          {value === null ? commonT("no") : commonT("yes")}
        </Label>
      </div>
    );
  }

  if (fieldKey === "estimate") {
    const displayValue =
      typeof value === "number" ? formatSeconds(value) : (value ?? "");
    return (
      <Input
        type="text"
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={commonT("placeholders.duration")}
        disabled={isDisabled}
      />
    );
  }

  if (fieldKey === "tags") {
    // Ensure value is always an array for ManageTags
    const selectedTagIds = Array.isArray(value) ? value.map(Number) : [];
    return (
      <ManageTags
        selectedTags={selectedTagIds}
        setSelectedTags={onChange}
        canCreateTags={canCreateTags}
      />
    );
  }

  if (fieldKey === "issues") {
    const selectedIssueIds = Array.isArray(value) ? value.map(Number) : [];
    return (
      <UnifiedIssueManager
        projectId={projectId}
        linkedIssueIds={selectedIssueIds}
        setLinkedIssueIds={onChange}
        entityType="testCase"
      />
    );
  }

  // --- Custom Fields ---
  if (!fieldDefinition || !fieldType) {
    // Render a disabled input or placeholder if fieldDefinition is missing for a custom field
    return <Input disabled placeholder={commonT("errors.error")} />;
  }

  switch (fieldType) {
    case "Dropdown":
      const dropdownOptions =
        fieldDefinition.fieldOptions?.map((fo: any) => ({
          id: fo.fieldOption.id,
          name: fo.fieldOption.name,
          icon: fo.fieldOption.icon?.name,
          iconColor: fo.fieldOption.iconColor?.value,
        })) ?? [];
      return (
        <Select
          value={value ? value.toString() : ""}
          onValueChange={(val) => onChange(Number(val))}
          disabled={isDisabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={commonT("placeholders.select")} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {dropdownOptions.map((option: any) => (
                <SelectItem key={option.id} value={option.id.toString()}>
                  <div className="flex items-center">
                    <DynamicIcon
                      className="shrink-0 mr-1 h-4 w-4"
                      name={option.icon as IconName}
                      color={option.iconColor}
                    />
                    {option.name}
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      );

    case "Multi-Select":
      const multiSelectOptions =
        fieldDefinition.fieldOptions?.map((fo: any) => ({
          value: fo.fieldOption.id,
          label: (
            <div className="flex items-center">
              <DynamicIcon
                className="h-4 w-4 mr-1"
                name={fo.fieldOption.icon?.name as IconName}
                color={fo.fieldOption.iconColor?.value}
              />
              {fo.fieldOption.name}
            </div>
          ),
        })) ?? [];
      const currentMultiSelectValue = multiSelectOptions.filter(
        (option: any) =>
          value && Array.isArray(value) && value.includes(option.value)
      );
      return (
        <MultiSelect
          value={currentMultiSelectValue}
          onChange={(selected: any) => {
            const selectedValues = selected
              ? selected.map((option: any) => option.value)
              : [];
            onChange(selectedValues);
          }}
          options={multiSelectOptions}
          isMulti
          styles={customStyles}
          placeholder={commonT("placeholders.select")}
          isDisabled={isDisabled}
        />
      );

    case "Checkbox":
      return (
        <div className="flex items-center space-x-2 h-10">
          <Switch
            id={`switch-${fieldKey}`}
            checked={value === null ? false : Boolean(value)}
            onCheckedChange={onChange}
            disabled={isDisabled}
          />
          <Label htmlFor={`switch-${fieldKey}`}>
            {value === null ? commonT("no") : commonT("yes")}
          </Label>
        </div>
      );

    case "Date":
      // Use Popover + Calendar instead of simple input
      const safeDateValue =
        value instanceof Date ? value : value ? new Date(value) : undefined;
      return (
        <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !safeDateValue && "text-muted-foreground"
              )}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              {safeDateValue ? (
                format(safeDateValue, "PPP", {
                  locale: getDateFnsLocale(locale),
                })
              ) : (
                <span>{commonT("placeholders.date")}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={safeDateValue}
              onSelect={(date) => {
                onChange(date ?? null); // Pass the selected date or null
                setIsDatePickerOpen(false); // Close popover on selection
              }}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      );

    case "Link":
      return (
        <Input
          type="url"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={commonT("editor.enterUrl")}
          disabled={isDisabled}
        />
      );

    case "Number":
      return (
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            onChange(val === "" ? null : Number(val)); // Allow clearing
          }}
          step="any" // Allow decimals
          disabled={isDisabled}
        />
      );

    case "Integer":
      return (
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            onChange(val === "" ? null : parseInt(val, 10) || null); // Parse as int
          }}
          step="1"
          disabled={isDisabled}
        />
      );

    case "String":
    case "Text String":
      return (
        <Input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={isDisabled}
        />
      );

    case "Text Long":
      let initialTextContent = emptyEditorContent;
      try {
        initialTextContent = value ? JSON.parse(value) : emptyEditorContent;
      } catch (error) {
        initialTextContent = emptyEditorContent;
      }

      const handleEditorUpdate = (content: any) => {
        try {
          const contentString = JSON.stringify(content);
          // Only call onChange if the stringified content is not the empty state,
          // otherwise send null to signify clearing the field.
          const isEmpty = contentString === JSON.stringify(emptyEditorContent);
          onChange(isEmpty ? null : contentString);
        } catch (error) {
          console.warn("Error stringifying editor content:", error);
          // Handle error, perhaps revert or show a message
          // For now, we might send null or the previous value if available
          onChange(null); // Or potentially keep the old value?
        }
      };

      // Determine initial height
      const initialHeight = fieldDefinition?.initialHeight;
      const editorClassName = `ring-2 ring-muted rounded-lg ${initialHeight ? `min-h-[${initialHeight}px]` : "min-h-[200px]"}`;
      const editorInnerClassName = initialHeight
        ? `min-h-[${initialHeight}px]`
        : "min-h-[100px]"; // Default inner min height

      return (
        <div className={editorClassName}>
          <TipTapEditor
            key={fieldKey}
            content={initialTextContent}
            onUpdate={handleEditorUpdate}
            projectId={String(projectId)}
            className={editorInnerClassName}
            readOnly={isDisabled}
          />
        </div>
      );

    case "Steps":
      const handleSaveSteps = () => {
        const stepsData = stepsFormMethods.getValues(fieldKey);
        // Call the main onChange handler to update the parent state
        onChange(stepsData);
        setIsStepsDialogOpen(false); // Close the dialog
        // Resetting the form here is not strictly necessary because the useEffect
        // will reset it based on the `value` prop when the dialog opens next time.
        // stepsFormMethods.reset({ [fieldKey]: [] }); // Optional: reset internal form state
      };

      const newStepsDefined = Array.isArray(value) && value.length > 0;

      return (
        <div className="flex items-center space-x-2">
          <div className="grow p-2 border rounded-md text-sm text-muted-foreground min-h-10">
            {newStepsDefined
              ? t("repository.bulkEdit.newStepsDefined", {
                  count: value.length,
                })
              : t("repository.bulkEdit.clearExistingStepsWarning")}
          </div>
          <Dialog open={isStepsDialogOpen} onOpenChange={setIsStepsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                {newStepsDefined ? "Edit New Steps" : "Set New Steps"}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[80%]">
              <DialogHeader>
                <DialogTitle>
                  {t("repository.bulkEdit.defineStepsTitle")}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {t("repository.bulkEdit.defineStepsTitle")}
                </DialogDescription>
              </DialogHeader>
              <FormProvider {...stepsFormMethods}>
                <form
                  onSubmit={stepsFormMethods.handleSubmit(handleSaveSteps)}
                  id="bulk-steps-form"
                >
                  <StepsForm
                    control={stepsFormMethods.control}
                    name={fieldKey}
                    readOnly={isDisabled}
                    projectId={projectId}
                  />
                </form>
              </FormProvider>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {commonT("actions.cancel")}
                  </Button>
                </DialogClose>
                <Button type="submit" form="bulk-steps-form">
                  {t("repository.bulkEdit.saveNewSteps")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {newStepsDefined && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
            >
              {commonT("actions.clear")}
            </Button>
          )}
        </div>
      );

    default:
      console.warn(`Unsupported field type in FieldValueInput: ${fieldType}`);
      return (
        <Input
          disabled
          value={`${commonT("errors.unsupportedFieldType")}: ${fieldType}`}
        />
      );
  }
}
