import DynamicIcon from "@/components/DynamicIcon";
import { DatePickerField } from "@/components/forms/DatePickerField";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Asterisk, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Control } from "react-hook-form";
import MultiSelect from "react-select";
import { emptyEditorContent } from "~/app/constants";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { editorMinHeightStyle } from "~/utils/editorHeight";
import StepsForm from "./StepsForm";

interface RenderFieldProps {
  field: any;
  control: Control<any>;
  onFocus?: () => void;
  onBlur?: () => void;
  canEditRestricted?: boolean;
  projectId: number;
  parameters?: ParameterChipMeta[];
  onOpenParametersSheet?: () => void;
}

const RenderField: React.FC<RenderFieldProps> = ({
  field,
  control,
  onFocus: _onFocus,
  onBlur: _onBlur,
  canEditRestricted = true,
  projectId,
  parameters,
  onOpenParametersSheet,
}) => {
  const tCommon = useTranslations("common");
  const defaultOption = field.caseField.fieldOptions?.find(
    (option: any) => option.fieldOption.isDefault
  );

  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });

  // State and memoization logic for "Text Long" type
  const [, setEditorContent] = useState("");

  // Determine if the field should be rendered/editable
  const isFieldRestricted = field.caseField.isRestricted;
  // We always render in AddCase, just might be disabled if we add that later
  // const canRenderField = !isFieldRestricted || canEditRestricted;

  const renderFieldControl = (onChange: any, value: any) => {
    // Disable control if restricted and no permission
    const isDisabled = isFieldRestricted && !canEditRestricted;

    switch (field.caseField.type.type) {
      case "Checkbox":
        return (
          <Switch
            checked={value}
            onCheckedChange={onChange}
            disabled={isDisabled}
          />
        );
      case "Date":
        return (
          <DatePickerField
            control={control}
            name={field.caseField.id.toString()}
            placeholder={field.caseField.hint || "Date"}
            disabled={isDisabled}
          />
        );
      case "Multi-Select": {
        // Ensure value is an array for Multi-Select
        const valueArray = Array.isArray(value)
          ? value
          : value != null
            ? [value]
            : [];

        return (
          <MultiSelect
            value={(field.caseField.fieldOptions ?? [])
              .filter((option: any) =>
                valueArray.includes(option.fieldOption.id)
              )
              .map((option: any) => ({
                value: option.fieldOption.id,
                label: (
                  <div className="flex items-center">
                    {option.fieldOption.icon &&
                      option.fieldOption.iconColor && (
                        <DynamicIcon
                          className="h-4 w-4 me-1"
                          name={option.fieldOption.icon.name}
                          color={option.fieldOption.iconColor.value}
                        />
                      )}
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
            options={(field.caseField.fieldOptions ?? [])
              .sort(
                (a: any, b: any) => a.fieldOption.order - b.fieldOption.order
              )
              .map((option: any) => ({
                value: option.fieldOption.id,
                label: (
                  <div className="flex items-center">
                    {option.fieldOption.icon &&
                      option.fieldOption.iconColor && (
                        <DynamicIcon
                          className="h-4 w-4 me-1"
                          name={option.fieldOption.icon.name}
                          color={option.fieldOption.iconColor.value}
                        />
                      )}
                    {option.fieldOption.name}
                  </div>
                ),
              }))}
            isMulti
            isDisabled={isDisabled}
            styles={customStyles}
          />
        );
      }
      case "Dropdown":
        const initialValue = defaultOption
          ? defaultOption.fieldOption.id
          : value;

        return (
          <FormControl>
            <Select
              onValueChange={(val) => {
                onChange(Number(val)); // Convert value to number
              }}
              value={value ? value.toString() : initialValue?.toString() || ""}
              disabled={isDisabled}
            >
              <SelectTrigger className="w-fit">
                <SelectValue
                  placeholder={tCommon("placeholders.selectOption")}
                />
              </SelectTrigger>
              <SelectContent>
                {(field.caseField.fieldOptions ?? [])
                  .sort(
                    (a: any, b: any) =>
                      a.fieldOption.order - b.fieldOption.order
                  )
                  .map((option: any) => (
                    <SelectItem
                      key={option.fieldOption.id}
                      value={option.fieldOption.id.toString()}
                    >
                      <div className="flex items-center">
                        {option.fieldOption.icon &&
                          option.fieldOption.iconColor && (
                            <DynamicIcon
                              className="h-4 w-4 me-1"
                              name={option.fieldOption.icon.name}
                              color={option.fieldOption.iconColor.value}
                            />
                          )}
                        {option.fieldOption.name}
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FormControl>
        );
      case "Integer":
        return (
          <Input
            type="number"
            placeholder={field.caseField.hint ? field.caseField.hint : ""}
            value={value ?? ""}
            min={field.caseField.minValue ? field.caseField.minValue : ""}
            max={field.caseField.maxValue ? field.caseField.maxValue : ""}
            onChange={(e) => {
              const val = e.target.value;
              onChange(val === "" ? "" : parseInt(val, 10));
            }}
            step={1}
            disabled={isDisabled}
          />
        );
      case "Number":
        return (
          <Input
            type="number"
            placeholder={field.caseField.hint ? field.caseField.hint : ""}
            value={value ?? ""}
            min={field.caseField.minValue ? field.caseField.minValue : ""}
            max={field.caseField.maxValue ? field.caseField.maxValue : ""}
            step="any"
            onChange={(e) => {
              const val = e.target.value;
              onChange(val === "" ? "" : parseFloat(val));
            }}
            disabled={isDisabled}
          />
        );
      case "Link":
        return (
          <Input
            type="url"
            placeholder={field.caseField.hint}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={isDisabled}
          />
        );
      case "Text String":
        return (
          <Input
            placeholder={field.caseField.hint}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={isDisabled}
          />
        );
      case "Text Long":
        // Function to handle editor updates
        const handleEditorUpdate = (content: any) => {
          try {
            const contentString = JSON.stringify(content);
            setEditorContent(contentString);
            onChange(contentString);
          } catch (error) {
            console.warn("Error in RenderField JSON.stringify:", error);
            const fallbackContent = JSON.stringify(emptyEditorContent);
            setEditorContent(fallbackContent);
            onChange(fallbackContent);
          }
        };

        // Determine initial content: value > defaultValue > emptyEditorContent
        let initialContent: any = emptyEditorContent;
        if (value) {
          try {
            initialContent = JSON.parse(value);
          } catch {
            // console.warn("Error parsing field value in RenderField:", e);
            // Keep initialContent as emptyEditorContent if value parsing fails
          }
        } else if (field.caseField.defaultValue) {
          try {
            initialContent = JSON.parse(field.caseField.defaultValue);
          } catch {
            // console.warn("Error parsing default value in RenderField:", e);
            // If defaultValue parsing fails, check if it's a plain string
            if (typeof field.caseField.defaultValue === "string") {
              // If it's a plain string, wrap it in TipTap structure
              initialContent = {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: field.caseField.defaultValue },
                    ],
                  },
                ],
              };
            } else {
              // Otherwise, fall back to emptyEditorContent
              initialContent = emptyEditorContent;
            }
          }
        }

        // Access initialHeight from the field definition
        const initialHeight = field.caseField.initialHeight;

        return (
          <div className="ring-2 ring-muted rounded-lg">
            <TipTapEditor
              key={field.caseField.id}
              content={initialContent} // Use determined initial content
              onUpdate={handleEditorUpdate}
              projectId={String(projectId)}
              className=""
              style={editorMinHeightStyle(initialHeight)}
              readOnly={isDisabled}
            />
          </div>
        );
      case "Steps":
        return (
          <StepsForm
            control={control}
            name={field.caseField.id.toString()}
            readOnly={isDisabled}
            projectId={projectId}
            parameters={parameters}
            onOpenParametersSheet={onOpenParametersSheet}
          />
        );
      default:
        return (
          <Input
            placeholder={field.caseField.hint}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={isDisabled}
          />
        );
    }
  };

  // Render the FormField regardless, but the control inside will be disabled if needed
  return (
    <FormField
      control={control}
      name={field.caseField.id.toString()}
      render={({ field: { onChange, value } }) => (
        <FormItem
          className="min-w-[300px] mx-1"
          data-testid={`field-${field.caseField.systemName}`}
        >
          <FormLabel
            className="flex items-center"
            data-testid={`field-${field.caseField.systemName}-label`}
          >
            {field.caseField.displayName}
            {field.caseField.isRequired && (
              <sup>
                <Asterisk className="w-3 h-3 text-destructive" />
              </sup>
            )}
            {isFieldRestricted && (
              <span
                title={tCommon("aria.restrictedField")}
                className="ms-1 text-muted-foreground"
              >
                <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground/50" />
              </span>
            )}
            {field.caseField.hint && (
              <HelpPopover
                helpKey={`## ${field.caseField.displayName}\n\n${field.caseField.hint}`}
              />
            )}
          </FormLabel>
          <FormControl
            data-testid={`field-${field.caseField.systemName}-input`}
          >
            {renderFieldControl(onChange, value)}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

export default RenderField;
