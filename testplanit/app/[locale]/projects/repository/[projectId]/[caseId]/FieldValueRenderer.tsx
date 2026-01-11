import React from "react";
import DynamicIcon from "@/components/DynamicIcon";
import { DateFormatter } from "@/components/DateFormatter";
import { Switch } from "@/components/ui/switch";
import { Controller } from "react-hook-form";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";
import { IconName } from "~/types/globals";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import StepsForm from "../StepsForm";
import { StepsDisplay } from "./StepsDisplay";
import { StepsResults } from "./StepsResults";
import { useTranslations } from "next-intl";
import { DatePickerField } from "@/components/forms/DatePickerField";
import { emptyEditorContent } from "~/app/constants";

import { Link } from "~/lib/navigation";
import { Minus, Plus } from "lucide-react";
import { Steps as PrismaSteps } from "@prisma/client";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";

// Re-defining DisplayStep here for clarity, assuming it's similar to StepsDisplay's internal type
interface DisplayStep extends PrismaSteps {
  isShared?: boolean;
  sharedStepGroupId: number | null;
  sharedStepGroupName?: string | null;
  // Potentially other fields if StepsDisplay or StepsResults augment it
}

interface FieldValueRendererProps {
  fieldValue: any;
  fieldType: string;
  caseId: string;
  template: any;
  fieldId: number;
  fieldIsRestricted?: boolean;
  session: any;
  isEditMode: boolean;
  isSubmitting: boolean;
  control: any;
  errors: any;
  previousFieldValue?: any;
  isRunMode?: boolean;
  canEditRestricted?: boolean;
  projectId?: number;
  onSharedStepCreated?: () => void;
  stepsForDisplay?: DisplayStep[];
  explicitFieldNameForSteps?: string;
}

const FieldValueRenderer: React.FC<FieldValueRendererProps> = ({
  fieldValue,
  fieldType,
  caseId,
  template,
  fieldId,
  fieldIsRestricted = false,
  session,
  isEditMode,
  isSubmitting,
  control,
  errors,
  previousFieldValue,
  isRunMode = false,
  canEditRestricted = true,
  projectId,
  onSharedStepCreated,
  stepsForDisplay,
  explicitFieldNameForSteps,
}) => {
  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });
  const error = errors?.[fieldId]?.message;
  const t = useTranslations();

  const isEmptyValue = (value: any): boolean => {
    // Handle Text Long fields with emptyEditorContent
    if (fieldType === "Text Long" && typeof value === "string") {
      try {
        const parsedContent = JSON.parse(value);
        const isEmptyEditor =
          JSON.stringify(parsedContent) === JSON.stringify(emptyEditorContent);
        if (isEmptyEditor) {
          return true;
        }
      } catch (e) {
        // Silently handle parsing errors
      }
    }

    if (value === null || value === undefined || value === "") {
      return true;
    }
    if (Array.isArray(value) && value.length === 0) {
      return true;
    }
    if (
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).length === 0
    ) {
      return true;
    }

    return false;
  };

  const arraysEqual = (a: any[], b: any[]) => {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, index) => val === sortedB[index]);
  };

  const renderDiffWrapper = (
    current: any,
    previous: any,
    renderer: (value: any) => React.ReactElement
  ) => {
    const isDifferent =
      Array.isArray(current) && Array.isArray(previous)
        ? !arraysEqual(current, previous)
        : current !== previous;

    if (isDifferent) {
      return (
        <div>
          <div className="relative p-1 rounded">
            <div className="absolute inset-0 bg-red-500/20 rounded pointer-events-none" />
            <span className="relative text-red-600 dark:text-red-400 flex space-x-1 items-center">
              <div>
                <Minus className="w-4 h-4" />
              </div>
              {renderer(previous)}
            </span>
          </div>
          <div className="relative p-1 rounded">
            <div className="absolute inset-0 bg-green-500/20 rounded pointer-events-none" />
            <span className="relative text-green-600 dark:text-green-400 flex space-x-1 items-center">
              <div>
                <Plus className="w-4 h-4" />
              </div>
              {renderer(current)}
            </span>
          </div>
        </div>
      );
    }

    return renderer(current);
  };

  const renderField = () => {
    const showDiff = previousFieldValue !== undefined;
    const isEffectivelyReadOnly =
      isEditMode && fieldIsRestricted && !canEditRestricted;

    if (fieldType === "Dropdown" || fieldType === "Multi-Select") {
      const caseField = template.caseFields.find(
        (cf: any) => cf.caseField.id === fieldId
      );
      if (!caseField) {
        return null;
      }

      if (fieldType === "Multi-Select") {
        const renderMultiSelect = (value: any) => (
          <div className="flex gap-2 whitespace-nowrap">
            {value.map((val: number) => {
              const option = caseField.caseField.fieldOptions.find(
                (fo: any) => fo.fieldOption.id === val
              );
              return option ? (
                <div key={val} className="flex items-center space-x-1">
                  <DynamicIcon
                    className="w-5 h-5 min-w-5 min-h-5"
                    name={option.fieldOption.icon?.name as IconName}
                    color={option.fieldOption.iconColor?.value}
                  />
                  <span className="pr-1">{option.fieldOption.name}</span>
                </div>
              ) : (
                <div key={val} className="text-gray-500">
                  {t("repository.fields.optionNotFound")}
                </div>
              );
            })}
          </div>
        );

        return isEditMode && !isEffectivelyReadOnly ? (
          <Controller
            control={control}
            name={fieldId.toString()}
            defaultValue={fieldValue}
            render={({ field: { onChange, value } }) => (
              <MultiSelect
                className="ml-1"
                value={caseField.caseField.fieldOptions
                  .filter(
                    (option: any) =>
                      value && value.includes(option.fieldOption.id)
                  )
                  .map((option: any) => ({
                    value: option.fieldOption.id,
                    label: (
                      <div className="flex items-center">
                        <DynamicIcon
                          className="h-4 w-4 mr-1"
                          name={option.fieldOption.icon.name}
                          color={option.fieldOption.iconColor.value}
                        />
                        {option.fieldOption.name}
                      </div>
                    ),
                  }))}
                onChange={(selected: any) => {
                  const selectedValues = selected
                    ? selected.map((option: any) => option.value)
                    : [];
                  onChange(selectedValues);
                }}
                options={caseField.caseField.fieldOptions
                  .sort(
                    (a: any, b: any) =>
                      a.fieldOption.order - b.fieldOption.order
                  )
                  .map((option: any) => ({
                    value: option.fieldOption.id,
                    label: (
                      <div className="flex items-center">
                        <DynamicIcon
                          className="h-4 w-4 mr-1"
                          name={option.fieldOption.icon.name}
                          color={option.fieldOption.iconColor.value}
                        />
                        {option.fieldOption.name}
                      </div>
                    ),
                  }))}
                isMulti
                isDisabled={isSubmitting}
                styles={customStyles}
              />
            )}
          />
        ) : showDiff ? (
          renderDiffWrapper(fieldValue, previousFieldValue, renderMultiSelect)
        ) : (
          renderMultiSelect(fieldValue)
        );
      }

      if (fieldType === "Dropdown") {
        const renderDropdown = (value: any) => {
          const option = caseField.caseField.fieldOptions.find(
            (option: any) => option.fieldOption.id === value
          );
          return (
            <div className="flex items-center space-x-1 ml-1 w-fit">
              <DynamicIcon
                className="w-5 h-5 min-w-5 min-h-5"
                name={option?.fieldOption.icon?.name as IconName}
                color={option?.fieldOption.iconColor?.value}
              />
              <span className="pr-1">{option?.fieldOption.name}</span>
            </div>
          );
        };

        return isEditMode && !isEffectivelyReadOnly ? (
          <Controller
            control={control}
            name={fieldId.toString()}
            defaultValue={fieldValue}
            render={({ field: { onChange, value } }) => (
              <Select
                key={
                  fieldId.toString() +
                  "-" +
                  (value ? value.toString() : "empty")
                }
                onValueChange={(val) => onChange(Number(val))}
                value={value ? value.toString() : ""}
                disabled={isSubmitting}
              >
                <SelectTrigger className="mx-1 w-fit">
                  <SelectValue
                    placeholder={t("common.placeholders.selectOption")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {caseField.caseField.fieldOptions.map((option: any) => (
                      <SelectItem
                        key={option.fieldOption.id}
                        value={option.fieldOption.id.toString()}
                      >
                        <div className="flex items-center">
                          <DynamicIcon
                            className="shrink-0 mr-1"
                            name={option.fieldOption.icon.name}
                            color={option.fieldOption.iconColor.value}
                          />
                          {option.fieldOption.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          />
        ) : showDiff ? (
          renderDiffWrapper(fieldValue, previousFieldValue, renderDropdown)
        ) : (
          renderDropdown(fieldValue)
        );
      }
    }

    // Render other field types
    switch (fieldType) {
      case "Checkbox":
        return isEditMode && !isEffectivelyReadOnly ? (
          <Controller
            control={control}
            name={fieldId.toString()}
            defaultValue={Boolean(fieldValue)}
            render={({ field: { onChange, value } }) => (
              <Switch
                checked={value}
                onCheckedChange={onChange}
                disabled={isSubmitting}
              />
            )}
          />
        ) : showDiff ? (
          renderDiffWrapper(
            Boolean(fieldValue).toString(),
            Boolean(previousFieldValue).toString(),
            (val) => <Switch disabled checked={val === "true"} />
          )
        ) : (
          <Switch disabled checked={Boolean(fieldValue)} />
        );
      case "Date":
        return isEditMode && !isEffectivelyReadOnly ? (
          <Controller
            control={control}
            name={fieldId.toString()}
            defaultValue={fieldValue}
            render={({ field }) => (
              <DatePickerField
                control={control}
                name={fieldId.toString()}
                placeholder={t("common.fields.date")}
                disabled={isSubmitting}
              />
            )}
          />
        ) : showDiff ? (
          renderDiffWrapper(fieldValue, previousFieldValue, (val) => (
            <DateFormatter
              date={val}
              formatString={session?.user.preferences?.dateFormat}
              timezone={session?.user.preferences?.timezone}
            />
          ))
        ) : (
          <DateFormatter
            date={fieldValue}
            formatString={session?.user.preferences?.dateFormat}
            timezone={session?.user.preferences?.timezone}
          />
        );
      case "Link":
        return isEditMode && !isEffectivelyReadOnly ? (
          <Controller
            control={control}
            name={fieldId.toString()}
            defaultValue={fieldValue}
            render={({ field: { onChange, value } }) => (
              <Input
                className="mx-1"
                type="url"
                value={value ?? ""}
                onChange={onChange}
                disabled={isSubmitting}
              />
            )}
          />
        ) : showDiff ? (
          renderDiffWrapper(fieldValue, previousFieldValue, (val) => (
            <Link target="_blank" href={val.toString()} rel="noreferrer">
              {val.toString()}
            </Link>
          ))
        ) : (
          <Link target="_blank" href={fieldValue.toString()} rel="noreferrer">
            {fieldValue.toString()}
          </Link>
        );
      case "Number":
      case "Integer":
        return isEditMode && !isEffectivelyReadOnly ? (
          <Controller
            control={control}
            name={fieldId.toString()}
            defaultValue={fieldValue}
            render={({ field: { onChange, value } }) => (
              <Input
                className="mx-1"
                type="number"
                value={value ?? ""}
                onChange={(e) => onChange(Number(e.target.value))}
                disabled={isSubmitting}
              />
            )}
          />
        ) : showDiff ? (
          renderDiffWrapper(fieldValue, previousFieldValue, (val) => <>{val}</>)
        ) : (
          fieldValue
        );
      case "Text String":
        return isEditMode && !isEffectivelyReadOnly ? (
          <Controller
            control={control}
            name={fieldId.toString()}
            defaultValue={fieldValue}
            render={({ field: { onChange, value } }) => (
              <Input
                className="mx-1"
                value={value ?? ""}
                onChange={onChange}
                disabled={isSubmitting}
              />
            )}
          />
        ) : showDiff ? (
          renderDiffWrapper(fieldValue, previousFieldValue, (val) => <>{val}</>)
        ) : (
          fieldValue
        );
      case "Text Long":
        const isEditorEditable =
          isEditMode && !isEffectivelyReadOnly && !isSubmitting;
        return isEditMode ? (
          <Controller
            control={control}
            name={fieldId.toString()}
            defaultValue={(() => {
              if (fieldValue && !isEmptyValue(fieldValue)) return fieldValue;
              const caseFieldDefinition = template.caseFields.find(
                (cf: any) => cf.caseField.id === fieldId
              )?.caseField;
              if (caseFieldDefinition?.defaultValue)
                return caseFieldDefinition.defaultValue;
              return emptyEditorContent;
            })()}
            render={({ field: { onChange, value } }) => {
              let initialEditorContent = null;
              try {
                initialEditorContent = value
                  ? JSON.parse(value)
                  : emptyEditorContent;
              } catch (error) {
                // console.warn("Error parsing JSON:", error);
                initialEditorContent = ensureTipTapJSON(value);
              }
              const handleEditorUpdate = (content: any) => {
                try {
                  const contentString = JSON.stringify(content);
                  onChange(contentString);
                } catch (error) {
                  console.warn(
                    "Error in FieldValueRenderer JSON.stringify:",
                    error
                  );
                  const fallbackContent = JSON.stringify(emptyEditorContent);
                  onChange(fallbackContent);
                }
              };

              // Find the field definition to check for initialHeight
              const caseFieldDefinition = template.caseFields.find(
                (cf: any) => cf.caseField.id === fieldId
              )?.caseField;
              const initialHeight = caseFieldDefinition?.initialHeight;
              const editorClassName = `ring-2 ring-muted rounded-lg ${
                initialHeight ? `min-h-[${initialHeight}px]` : "min-h-[300px]"
              }`;

              return (
                <div className={editorClassName}>
                  <TipTapEditor
                    key={fieldId}
                    content={initialEditorContent}
                    onUpdate={handleEditorUpdate}
                    projectId={projectId ? String(projectId) : undefined}
                    className={
                      initialHeight
                        ? `min-h-[${initialHeight}px]`
                        : "min-h-[100px]" // Keep inner class if needed, or adjust
                    }
                    readOnly={!isEditorEditable}
                  />
                </div>
              );
            }}
          />
        ) : showDiff ? (
          renderDiffWrapper(fieldValue, previousFieldValue, (val) => {
            let content = null;
            try {
              content = val ? JSON.parse(val) : emptyEditorContent;
            } catch (error) {
              // console.warn("Error parsing JSON in diff view:", error);
              content = ensureTipTapJSON(val);
            }
            return (
              <TipTapEditor
                content={content}
                projectId={projectId?.toString()}
                readOnly
                className="max-h-[100px] overflow-auto hover:max-h-fit"
              />
            );
          })
        ) : (
          (() => {
            let content = null;
            try {
              content = fieldValue
                ? JSON.parse(fieldValue)
                : emptyEditorContent;
            } catch (error) {
              // console.warn("Error parsing JSON in view mode:", error);
              content = ensureTipTapJSON(fieldValue);
            }
            return (
              <TipTapEditor
                content={content}
                projectId={projectId?.toString()}
                readOnly
                className="max-h-[100px] overflow-auto hover:max-h-fit"
              />
            );
          })()
        );
      case "Steps":
        if (isEditMode && !isEffectivelyReadOnly) {
          return (
            <StepsForm
              control={control}
              name={explicitFieldNameForSteps || fieldId.toString()}
              steps={fieldValue}
              readOnly={isEffectivelyReadOnly}
              projectId={projectId!}
              onSharedStepCreated={onSharedStepCreated}
            />
          );
        } else if (isRunMode) {
          return (
            <StepsResults
              steps={stepsForDisplay || fieldValue || []}
              projectId={projectId}
            />
          );
        } else {
          return (
            <StepsDisplay
              steps={stepsForDisplay || fieldValue || []}
              previousSteps={previousFieldValue}
            />
          );
        }
      default:
        return fieldValue;
    }
  };

  return (
    <div>
      {(!isRunMode || !isEmptyValue(fieldValue)) && renderField()}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
};

export default FieldValueRenderer;
