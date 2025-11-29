import { useState } from "react";
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  FormField,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import DynamicIcon from "@/components/DynamicIcon";
import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import StepsForm from "./StepsForm";
import { Control } from "react-hook-form";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { HelpPopover } from "@/components/ui/help-popover";
import { DatePickerField } from "@/components/forms/DatePickerField";
import { emptyEditorContent } from "~/app/constants";
import { LockIcon, Asterisk } from "lucide-react";

interface RenderFieldProps {
  field: any;
  control: Control<any>;
  onFocus?: () => void;
  onBlur?: () => void;
  canEditRestricted?: boolean;
  projectId: number;
}

const RenderField: React.FC<RenderFieldProps> = ({
  field,
  control,
  onFocus,
  onBlur,
  canEditRestricted = true,
  projectId,
}) => {
  const defaultOption = field.caseField.fieldOptions.find(
    (option: any) => option.fieldOption.isDefault
  );

  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });

  // State and memoization logic for "Text Long" type
  const [editorContent, setEditorContent] = useState("");

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
      case "Multi-Select":
        return (
          <MultiSelect
            value={field.caseField.fieldOptions
              .filter(
                (option: any) => value && value.includes(option.fieldOption.id)
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
            options={field.caseField.fieldOptions
              .sort(
                (a: any, b: any) => a.fieldOption.order - b.fieldOption.order
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
            isDisabled={isDisabled}
            styles={customStyles}
          />
        );
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
              value={value ? value.toString() : initialValue.toString()}
              disabled={isDisabled}
            >
              <SelectTrigger className="w-fit">
                <SelectValue placeholder="Select an option" />
              </SelectTrigger>
              <SelectContent>
                {field.caseField.fieldOptions
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
                        <DynamicIcon
                          className="h-4 w-4 mr-1"
                          name={option.fieldOption.icon.name}
                          color={option.fieldOption.iconColor.value}
                        />
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
            value={value}
            min={field.caseField.minValue ? field.caseField.minValue : ""}
            max={field.caseField.maxValue ? field.caseField.maxValue : ""}
            onChange={(e) => onChange(parseInt(e.target.value, 10))}
            step={1}
            disabled={isDisabled}
          />
        );
      case "Number":
        return (
          <Input
            type="number"
            placeholder={field.caseField.hint ? field.caseField.hint : ""}
            value={value}
            min={field.caseField.minValue ? field.caseField.minValue : ""}
            max={field.caseField.maxValue ? field.caseField.maxValue : ""}
            step="any"
            onChange={(e) => onChange(parseFloat(e.target.value))}
            disabled={isDisabled}
          />
        );
      case "Link":
        return (
          <Input
            type="url"
            placeholder={field.caseField.hint}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={isDisabled}
          />
        );
      case "Text String":
        return (
          <Input
            placeholder={field.caseField.hint}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            defaultValue={
              field.caseField.defaultValue ? field.caseField.defaultValue : ""
            }
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
          } catch (e) {
            // console.warn("Error parsing field value in RenderField:", e);
            // Keep initialContent as emptyEditorContent if value parsing fails
          }
        } else if (field.caseField.defaultValue) {
          try {
            initialContent = JSON.parse(field.caseField.defaultValue);
          } catch (e) {
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
        const editorClassName = `ring-2 ring-muted rounded-lg ${
          initialHeight ? `min-h-[${initialHeight}px]` : "min-h-[300px]"
        }`;

        return (
          <div className={editorClassName}>
            <TipTapEditor
              key={field.caseField.id}
              content={initialContent} // Use determined initial content
              onUpdate={handleEditorUpdate}
              projectId={String(projectId)}
              className={
                initialHeight ? `min-h-[${initialHeight}px]` : "min-h-[300px]"
              }
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
        <FormItem className="min-w-[300px] mx-1">
          <FormLabel className="flex items-center">
            {field.caseField.displayName}
            {field.caseField.isRequired && (
              <sup>
                <Asterisk className="w-3 h-3 text-destructive" />
              </sup>
            )}
            {isFieldRestricted && (
              <span
                title="Restricted Field"
                className="ml-1 text-muted-foreground"
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
          <FormControl>{renderFieldControl(onChange, value)}</FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

export default RenderField;
