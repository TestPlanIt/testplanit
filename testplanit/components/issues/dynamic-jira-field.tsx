"use client";

import { useState } from "react";
import { UseFormReturn, Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { HelpPopover } from "@/components/ui/help-popover";

interface JiraField {
  key: string;
  name: string;
  required: boolean;
  description?: string;
  schema: {
    type: string;
    items?: string;
    system?: string;
  };
  allowedValues?: Array<{
    id: string;
    name?: string;
    value?: string;
    description?: string;
  }>;
  hasDefaultValue?: boolean;
  defaultValue?: any;
  autoCompleteUrl?: string;
}

interface DynamicJiraFieldProps {
  field: JiraField;
  form: UseFormReturn<any>;
  integrationId: number;
  projectKey?: string;
}

// Separate component for description field to avoid hooks in render function
function DescriptionField({
  field,
  formField,
  t,
}: {
  field: JiraField;
  formField: any;
  t: any;
}) {
  const [tiptapContent, setTiptapContent] = useState(
    formField.value && typeof formField.value === "object"
      ? formField.value
      : { type: "doc", content: [] }
  );

  return (
    <FormItem>
      <div className="flex items-center gap-2">
        <FormLabel>
          {field.name}
          {field.required && (
            <span className="text-destructive ml-1">{"*"}</span>
          )}
        </FormLabel>
        {field.description && (
          <HelpPopover helpKey={`## ${field.description}`} />
        )}
      </div>
      <FormControl>
        <TipTapEditor
          content={tiptapContent}
          onUpdate={(content) => {
            setTiptapContent(content);
            // Pass TipTap JSON directly - the adapter will convert to ADF
            // console.log('[DEBUG] TipTap JSON for Jira:', content);
            formField.onChange(content);
          }}
          readOnly={false}
          projectId="jira-temp"
          placeholder={t("issues.enterDescription")}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}

// Separate component for user picker to avoid hooks in render function
function UserPickerField({
  field,
  formField,
  t,
  integrationId,
  projectKey,
}: {
  field: JiraField;
  formField: any;
  t: any;
  integrationId: number;
  projectKey?: string;
}) {
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    name: string;
  } | null>(
    formField.value ? { id: formField.value, name: formField.value } : null
  );

  return (
    <FormItem>
      <div className="flex items-center gap-2">
        <FormLabel>
          {field.name}
          {field.required && (
            <span className="text-destructive ml-1">{"*"}</span>
          )}
        </FormLabel>
        {field.description && (
          <HelpPopover helpKey={`## ${field.description}`} />
        )}
      </div>
      <FormControl>
        <AsyncCombobox
          value={selectedUser}
          onValueChange={(value) => {
            setSelectedUser(value);
            formField.onChange(value?.id || "");
          }}
          fetchOptions={async (query, page, pageSize) => {
            try {
              const params = new URLSearchParams({
                query,
                startAt: (page * pageSize).toString(),
                maxResults: pageSize.toString(),
              });
              if (projectKey) {
                params.append("projectKey", projectKey);
              }
              const response = await fetch(
                `/api/integrations/${integrationId}/search-users?${params.toString()}`
              );
              if (!response.ok) throw new Error("Failed to search users");

              const data = await response.json();
              return {
                results: data.users.map((user: any) => ({
                  id: user.accountId,
                  name: user.displayName || user.emailAddress,
                })),
                total: data.total || data.users.length,
              };
            } catch (error) {
              console.error("Failed to search users:", error);
              return { results: [], total: 0 };
            }
          }}
          renderOption={(user) => user.name}
          getOptionValue={(user) => user.id}
          placeholder={t("common.searchUsers")}
          showUnassigned={true}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}

// Separate component for labels to avoid hooks in render function
function LabelsInput({
  field,
  formField,
  t,
}: {
  field: JiraField;
  formField: any;
  t: any;
}) {
  const [inputValue, setInputValue] = useState("");
  const labels = formField.value || [];

  const addLabel = () => {
    if (inputValue.trim()) {
      // Replace spaces with hyphens for Jira compatibility
      const sanitizedLabel = inputValue.trim().replace(/\s+/g, "-");
      if (!labels.includes(sanitizedLabel)) {
        formField.onChange([...labels, sanitizedLabel]);
        setInputValue("");
      }
    }
  };

  const removeLabel = (label: string) => {
    formField.onChange(labels.filter((l: string) => l !== label));
  };

  return (
    <FormItem>
      <FormLabel>
        {field.name}
        {field.required && <span className="text-destructive ml-1">{"*"}</span>}
      </FormLabel>
      <FormControl>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLabel();
                }
              }}
              placeholder={t("issues.addLabel")}
              title={t("issues.labelHint")}
            />
            <Button
              type="button"
              variant="outline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                addLabel();
              }}
              disabled={!inputValue.trim()}
            >
              {t("common.add")}
            </Button>
          </div>
          {labels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {labels.map((label: string) => (
                <Badge
                  key={label}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => removeLabel(label)}
                >
                  {label}
                  <span className="ml-1">{"×"}</span>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </FormControl>
      <FormDescription className="text-xs">
        {t("issues.labelFormatNote")}
      </FormDescription>
      <FormMessage />
    </FormItem>
  );
}

export function DynamicJiraField({
  field,
  form,
  integrationId,
  projectKey,
}: DynamicJiraFieldProps) {
  const t = useTranslations();
  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme: theme || "light" });

  // Helper function to render select fields
  const renderSelectField = (isSingle = true) => {
    const options = field.allowedValues!.map((v) => ({
      value: v.id || v.value,
      label: v.name || v.value || v.id,
    }));

    if (!isSingle || field.schema.type === "array") {
      // Multi-select - use Controller for proper value handling
      return (
        <FormItem>
          <div className="flex items-center gap-2">
            <FormLabel>
              {field.name}
              {field.required && (
                <span className="text-destructive ml-1">{"*"}</span>
              )}
            </FormLabel>
            {field.description && (
              <HelpPopover helpKey={`## ${field.description}`} />
            )}
          </div>
          <FormControl>
            <Controller
              control={form.control}
              name={field.key}
              render={({ field: formField }) => (
                <MultiSelect
                  {...formField}
                  isMulti
                  maxMenuHeight={300}
                  classNamePrefix="select"
                  styles={customStyles}
                  options={options}
                  placeholder={t("common.selectMultiple")}
                  onChange={(selected: any) => {
                    const values = selected
                      ? selected.map((s: any) => s.value)
                      : [];
                    formField.onChange(values);
                  }}
                  value={options.filter((option) =>
                    (formField.value || []).includes(option.value)
                  )}
                />
              )}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      );
    }

    // Single select - use AsyncCombobox for searchability
    return (
      <FormField
        control={form.control}
        name={field.key}
        render={({ field: formField }) => (
          <FormItem>
            <div className="flex items-center gap-2">
              <FormLabel>
                {field.name}
                {field.required && (
                  <span className="text-destructive ml-1">{"*"}</span>
                )}
              </FormLabel>
              {field.description && (
                <HelpPopover helpKey={`## ${field.description}`} />
              )}
            </div>
            <FormControl>
              <AsyncCombobox
                value={
                  options.find((opt) => opt.value === formField.value) || null
                }
                onValueChange={(value) => {
                  formField.onChange(value?.value || "");
                }}
                fetchOptions={async (query, page, pageSize) => {
                  const filtered = query
                    ? options.filter((opt) =>
                        opt.label.toLowerCase().includes(query.toLowerCase())
                      )
                    : options;

                  const start = page * pageSize;
                  const end = start + pageSize;
                  return {
                    results: filtered.slice(start, end),
                    total: filtered.length,
                  };
                }}
                renderOption={(opt) => opt.label}
                getOptionValue={(opt) => opt.value || ""}
                placeholder={t("common.select")}
                className="w-full text-left"
                showTotal
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };

  // Render different field types based on schema
  const renderField = () => {
    // Text fields
    if (field.key === "summary") {
      return (
        <FormField
          control={form.control}
          name={field.key}
          render={({ field: formField }) => (
            <FormItem>
              <div className="flex items-center gap-2">
                <FormLabel>
                  {field.name}
                  {field.required && (
                    <span className="text-destructive ml-1">{"*"}</span>
                  )}
                </FormLabel>
                {field.description && (
                  <HelpPopover helpKey={`## ${field.description}`} />
                )}
              </div>
              <FormControl>
                <Input {...formField} placeholder={t("issues.enterSummary")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      );
    }

    // Description field with TipTap Editor
    if (field.key === "description" || field.schema.type === "richtext") {
      return (
        <FormField
          control={form.control}
          name={field.key}
          render={({ field: formField }) => (
            <DescriptionField field={field} formField={formField} t={t} />
          )}
        />
      );
    }

    // Select fields with allowed values (including Flagged field)
    if (field.allowedValues && field.allowedValues.length > 0) {
      // Special handling for Flagged field - it's an array field with typically one option
      if (field.key === "flagged" || field.name.toLowerCase() === "flagged") {
        return (
          <FormField
            control={form.control}
            name={field.key}
            render={({ field: formField }) => {
              const currentValue = formField.value || [];
              const isChecked =
                currentValue.length > 0 &&
                currentValue[0]?.id === field.allowedValues![0]?.id;

              return (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) => {
                        if (
                          checked &&
                          field.allowedValues &&
                          field.allowedValues[0]
                        ) {
                          formField.onChange([field.allowedValues[0]]);
                        } else {
                          formField.onChange([]);
                        }
                      }}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>
                      {field.name}
                      {field.required && (
                        <span className="text-destructive ml-1">{"*"}</span>
                      )}
                    </FormLabel>
                    {field.allowedValues && field.allowedValues[0] && (
                      <FormDescription>
                        {field.allowedValues[0].name || "Flag this issue"}
                      </FormDescription>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        );
      }

      // Use the helper function for other select fields
      return renderSelectField(field.schema.type !== "array");
    }

    // User picker fields (assignee, reporter, etc.)
    if (
      field.schema.type === "user" ||
      field.key === "assignee" ||
      field.key === "reporter"
    ) {
      return (
        <FormField
          control={form.control}
          name={field.key}
          render={({ field: formField }) => (
            <UserPickerField
              field={field}
              formField={formField}
              t={t}
              integrationId={integrationId}
              projectKey={projectKey}
            />
          )}
        />
      );
    }

    // Issue link fields - allow searching for issues to link
    if (field.schema.type === "issuelink" || field.key.includes("issuelink")) {
      return (
        <FormField
          control={form.control}
          name={field.key}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>
                {field.name}
                {field.required && (
                  <span className="text-destructive ml-1">{"*"}</span>
                )}
              </FormLabel>
              <FormControl>
                <AsyncCombobox
                  value={
                    formField.value
                      ? { id: formField.value, name: formField.value }
                      : null
                  }
                  onValueChange={(value) => formField.onChange(value?.id || "")}
                  fetchOptions={async (query) => {
                    try {
                      const response = await fetch(
                        `/api/integrations/${integrationId}/search-issues?query=${encodeURIComponent(query)}`
                      );
                      if (!response.ok)
                        throw new Error("Failed to search issues");

                      const data = await response.json();
                      return {
                        results: data.issues.map((issue: any) => ({
                          id: issue.key,
                          name: `${issue.key}: ${issue.title}`,
                        })),
                        total: data.total,
                      };
                    } catch (error) {
                      console.error("Failed to search issues:", error);
                      return { results: [], total: 0 };
                    }
                  }}
                  renderOption={(issue) => issue.name}
                  getOptionValue={(issue) => issue.id}
                  placeholder={t("issues.searchForIssue")}
                />
              </FormControl>
              <FormDescription>{t("issues.issueLinkHelp")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      );
    }

    // Team field - should be a dropdown
    if (
      field.key === "customfield_10001" ||
      field.name.toLowerCase().includes("team")
    ) {
      // If no values available, show disabled combobox
      if (!field.allowedValues || field.allowedValues.length === 0) {
        return (
          <FormField
            control={form.control}
            name={field.key}
            render={({ field: formField }) => (
              <FormItem>
                <div className="flex items-center gap-2">
                  <FormLabel>
                    {field.name}
                    {field.required && (
                      <span className="text-destructive ml-1">{"*"}</span>
                    )}
                  </FormLabel>
                  {field.description && (
                    <HelpPopover helpKey={`## ${field.description}`} />
                  )}
                </div>
                <FormControl>
                  <AsyncCombobox
                    value={null}
                    onValueChange={() => {}}
                    fetchOptions={async () => ({ results: [], total: 0 })}
                    renderOption={() => ""}
                    getOptionValue={() => ""}
                    placeholder={t("issues.noTeamsAvailable")}
                    disabled
                    className="w-full"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );
      }
      return renderSelectField();
    }

    // Labels field (array of strings)
    if (field.key === "labels" && field.schema.type === "array") {
      return (
        <FormField
          control={form.control}
          name={field.key}
          render={({ field: formField }) => (
            <LabelsInput field={field} formField={formField} t={t} />
          )}
        />
      );
    }

    // Default to text input for unknown field types
    return (
      <FormField
        control={form.control}
        name={field.key}
        render={({ field: formField }) => (
          <FormItem>
            <FormLabel>
              {field.name}
              {field.required && (
                <span className="text-destructive ml-1">{"*"}</span>
              )}
            </FormLabel>
            <FormControl>
              <Input {...formField} />
            </FormControl>
            {field.schema.type !== "string" && (
              <FormDescription>
                {t("common.ui.issues.fieldType")}
                {field.schema.type}
              </FormDescription>
            )}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };

  return renderField();
}
