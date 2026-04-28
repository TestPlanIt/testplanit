"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormItem, FormLabel } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Asterisk, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { useFindManyIntegrationProject } from "~/lib/hooks";
import { DynamicJiraField } from "./dynamic-jira-field";

interface JiraField {
  key: string;
  name: string;
  required: boolean;
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

interface JiraProject {
  id: string;
  key: string;
  name: string;
}

interface CreateIssueJiraFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  integrationId: number;
  projectIntegrationId: string;
  /** @deprecated Use projectIntegrationId — kept for backward compat */
  projectKey?: string;
  /** @deprecated Use projectIntegrationId — kept for backward compat */
  issueTypeId?: string;
  onIssueCreated?: (issue: any) => void;
  defaultValues?: {
    title?: string;
    description?: string;
  };
}

export function CreateIssueJiraForm({
  open,
  onOpenChange,
  projectId: _projectId,
  integrationId,
  projectIntegrationId,
  projectKey: _legacyProjectKey,
  issueTypeId: _legacyIssueTypeId,
  onIssueCreated,
  defaultValues,
}: CreateIssueJiraFormProps) {
  const t = useTranslations();
  const [isLoading, setIsLoading] = useState(false);
  const [fields, setFields] = useState<JiraField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [issueTypesLoading, setIssueTypesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueTypes, setIssueTypes] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [selectedIssueType, setSelectedIssueType] = useState<string>("");
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>("");

  // Fetch linked IntegrationProject records instead of all external projects
  const { data: integrationProjects, isLoading: projectsLoading } =
    useFindManyIntegrationProject(
      {
        where: {
          projectIntegrationId,
          isActive: true,
        },
        orderBy: [{ isDefault: "desc" }, { externalProjectName: "asc" }],
      },
      { enabled: !!projectIntegrationId }
    );

  // Convert IntegrationProject records to JiraProject shape for the selector
  const projects = useMemo<JiraProject[]>(() => {
    if (!integrationProjects) return [];
    return integrationProjects.map((ip) => ({
      id: ip.externalProjectId,
      key: ip.externalProjectKey,
      name: ip.externalProjectName,
    }));
  }, [integrationProjects]);

  // Auto-select the default project and its issue type when data loads
  useEffect(() => {
    if (!open || !integrationProjects || integrationProjects.length === 0)
      return;
    if (selectedProjectKey) return; // Already selected

    const defaultProject =
      integrationProjects.find((ip) => ip.isDefault) || integrationProjects[0];
    setSelectedProjectKey(defaultProject.externalProjectKey);
    if (defaultProject.defaultIssueType) {
      setSelectedIssueType(defaultProject.defaultIssueType);
    }
  }, [open, integrationProjects, selectedProjectKey]);

  // When project selection changes, update the default issue type from IntegrationProject
  useEffect(() => {
    if (!selectedProjectKey || !integrationProjects) return;
    const ip = integrationProjects.find(
      (p) => p.externalProjectKey === selectedProjectKey
    );
    if (ip?.defaultIssueType) {
      setSelectedIssueType(ip.defaultIssueType);
    }
  }, [selectedProjectKey, integrationProjects]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedProjectKey("");
      setSelectedIssueType("");
      setFields([]);
      setIssueTypes([]);
    }
  }, [open]);

  // Build dynamic schema based on fields
  const buildSchema = (fields: JiraField[]) => {
    const schemaObject: Record<string, any> = {};

    fields.forEach((field) => {
      let fieldSchema: any;

      switch (field.schema.type) {
        case "string":
          fieldSchema = z.string();
          if (field.required) {
            fieldSchema = fieldSchema.min(1, `${field.name} is required`);
          } else {
            fieldSchema = fieldSchema.optional();
          }
          break;

        case "number":
          fieldSchema = z.number();
          if (!field.required) {
            fieldSchema = fieldSchema.optional();
          }
          break;

        case "array":
          if (field.schema.items === "string") {
            fieldSchema = z.array(z.string());
          } else {
            fieldSchema = z.array(z.any());
          }
          if (!field.required) {
            fieldSchema = fieldSchema.optional();
          }
          break;

        case "user":
        case "option":
        case "priority":
        case "version":
        case "component":
          fieldSchema = z.string();
          if (!field.required) {
            fieldSchema = fieldSchema.optional();
          }
          break;

        default:
          fieldSchema = z.any();
          if (!field.required) {
            fieldSchema = fieldSchema.optional();
          }
      }

      schemaObject[field.key] = fieldSchema;
    });

    return z.object(schemaObject);
  };

  // Fetch issue types when project changes
  useEffect(() => {
    const fetchIssueTypes = async () => {
      if (!open || !selectedProjectKey) return;

      setIssueTypesLoading(true);
      try {
        const response = await fetch(
          `/api/integrations/${integrationId}/issue-types?projectKey=${selectedProjectKey}`
        );

        if (response.ok) {
          const data = await response.json();
          setIssueTypes(data.issueTypes || []);

          // Set issue type: use per-project default from IntegrationProject, or first available
          if (data.issueTypes?.length > 0) {
            const ip = integrationProjects?.find(
              (p) => p.externalProjectKey === selectedProjectKey
            );
            const perProjectDefault = ip?.defaultIssueType;
            const defaultType = perProjectDefault
              ? data.issueTypes.find((t: any) => t.id === perProjectDefault)
              : null;
            setSelectedIssueType(defaultType?.id || data.issueTypes[0].id);
          } else {
            setSelectedIssueType("");
          }
        }
      } catch (error) {
        console.error("Failed to fetch issue types:", error);
      } finally {
        setIssueTypesLoading(false);
      }
    };

    void fetchIssueTypes();
  }, [open, selectedProjectKey, integrationId, integrationProjects]);

  // Fetch fields based on issue type
  useEffect(() => {
    const fetchFields = async () => {
      if (!selectedIssueType || !selectedProjectKey) return;

      setFieldsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/integrations/${integrationId}/issue-type-fields?projectKey=${selectedProjectKey}&issueTypeId=${selectedIssueType}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch issue fields");
        }

        const data = await response.json();

        // Fields to exclude from user input (system-managed or handled separately)
        const excludedFields = [
          "development", // System-managed: links to commits/branches
          "attachment", // Handled after creation
          "issuelinks", // Handled separately
          "rank", // System-managed: internal ranking
          "worklog", // Added after creation
          "comment", // Added after creation
          "votes", // System field
          "watches", // System field
          "subtasks", // Handled separately
          "resolutiondate", // System field
          "lastviewed", // System field
          "created", // System field
          "updated", // System field
          "creator", // System field
          "resolution", // Set through workflow
          "aggregatetimeestimate", // Calculated field
          "aggregatetimeoriginalestimate", // Calculated field
          "aggregatetimespent", // Calculated field
          "statuscategorychangedate", // System field
          "parent", // For subtasks, handled separately
        ];

        // Filter out excluded fields
        let filteredFields = data.fields.filter((f: JiraField) => {
          // Check if field is in excluded list
          if (excludedFields.includes(f.key.toLowerCase())) {
            return false;
          }
          // Also filter out fields with unclear/problematic types
          const fieldNameLower = f.name.toLowerCase();
          if (
            fieldNameLower.includes("design") ||
            fieldNameLower.includes("vulnerability") ||
            fieldNameLower.includes("rank") ||
            fieldNameLower.includes("development")
          ) {
            return false;
          }
          return true;
        });

        // Find summary and description fields
        const summaryField = filteredFields.find(
          (f: JiraField) => f.key === "summary"
        );
        const descriptionField = filteredFields.find(
          (f: JiraField) => f.key === "description"
        );

        // Remove summary and description from the array to re-add them at the top
        filteredFields = filteredFields.filter(
          (f: JiraField) => f.key !== "summary" && f.key !== "description"
        );

        const orderedFields = [];

        // Add summary first (always required)
        if (summaryField) {
          orderedFields.push(summaryField);
        } else {
          orderedFields.push({
            key: "summary",
            name: "Summary",
            required: true,
            schema: { type: "string" },
          });
        }

        // Add description second with richtext type for TipTap
        if (descriptionField) {
          orderedFields.push({
            ...descriptionField,
            schema: { ...descriptionField.schema, type: "richtext" },
          });
        } else {
          orderedFields.push({
            key: "description",
            name: "Description",
            required: false,
            schema: { type: "richtext" },
          });
        }

        // Add the rest of the fields
        orderedFields.push(...filteredFields);

        setFields(orderedFields);
      } catch (error) {
        console.error("Failed to fetch fields:", error);
        setError(t("issues.failedToFetchFields"));
      } finally {
        setFieldsLoading(false);
      }
    };

    if (open && selectedProjectKey && selectedIssueType) {
      void fetchFields();
    }
  }, [open, selectedProjectKey, selectedIssueType, integrationId, t]);

  // Initialize form with dynamic schema
  const form = useForm<any>({
    resolver: fields.length > 0 ? zodResolver(buildSchema(fields)) : undefined,
    defaultValues: {
      summary: defaultValues?.title || "",
      description: defaultValues?.description || "",
    },
  });

  // Update form values when fields change
  useEffect(() => {
    if (fields.length > 0) {
      const newDefaults: Record<string, any> = {
        summary: defaultValues?.title || "",
        description: defaultValues?.description || "",
      };

      // Set default values from field metadata
      fields.forEach((field) => {
        if (field.hasDefaultValue && field.defaultValue !== undefined) {
          newDefaults[field.key] = field.defaultValue;
        }
      });

      form.reset(newDefaults);
    }
  }, [fields, defaultValues, form]);

  const onSubmit = async (data: any) => {
    setIsLoading(true);
    setError(null);

    try {
      // Transform form data to Jira API format
      const jiraData = {
        projectId: selectedProjectKey,
        issueType: selectedIssueType,
        title: data.summary,
        description: data.description, // This will be TipTap JSON, adapter will convert to ADF
        customFields: {} as Record<string, any>,
      };

      // Add other fields
      fields.forEach((field) => {
        if (
          field.key !== "summary" &&
          field.key !== "description" &&
          data[field.key]
        ) {
          // Handle special field types
          if (
            field.schema.type === "priority" ||
            field.schema.type === "option"
          ) {
            jiraData.customFields[field.key] = { id: data[field.key] };
          } else if (field.schema.type === "user") {
            jiraData.customFields[field.key] = { accountId: data[field.key] };
          } else if (
            field.schema.type === "array" &&
            field.schema.items === "component"
          ) {
            jiraData.customFields[field.key] = data[field.key].map(
              (id: string) => ({ id })
            );
          } else if (
            field.schema.type === "array" &&
            field.schema.items === "version"
          ) {
            jiraData.customFields[field.key] = data[field.key].map(
              (id: string) => ({ id })
            );
          } else {
            jiraData.customFields[field.key] = data[field.key];
          }
        }
      });

      const response = await fetch(
        `/api/integrations/${integrationId}/create-issue`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(jiraData),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create issue");
      }

      const createdIssue = await response.json();

      onIssueCreated?.(createdIssue);
      onOpenChange(false);
      form.reset();
    } catch (error) {
      console.error("Failed to create issue:", error);
      setError(
        error instanceof Error ? error.message : t("issues.failedToCreateIssue")
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("issues.createIssueInJira")}</DialogTitle>
          <DialogDescription>
            {t("issues.fillInRequiredFields")}
          </DialogDescription>
        </DialogHeader>

        {!selectedProjectKey && !projectsLoading && projects.length === 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("issues.integrationNotConfigured")}</AlertTitle>
            <AlertDescription>
              {t("issues.integrationNotConfiguredDescription")}
            </AlertDescription>
          </Alert>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : projectsLoading ||
          issueTypesLoading ||
          fieldsLoading ||
          // Cover render gaps between the chained projects → issue-types → fields
          // effects so the spinner stays continuous until the form is ready.
          (projects.length > 0 && fields.length === 0) ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit(onSubmit)(e);
              }}
              className="space-y-4"
              autoComplete="off"
            >
              {/* Project Selector — hide when only one project is available
                  since selection is automatic */}
              {projects.length > 1 && (
                <FormItem>
                  <FormLabel className="inline-flex items-center gap-0.5">
                    {t("issues.externalProject")}
                    <sup>
                      <Asterisk className="w-3 h-3 text-destructive" />
                    </sup>
                  </FormLabel>
                  <Select
                    value={selectedProjectKey}
                    onValueChange={(value) => {
                      setSelectedProjectKey(value);
                      // Reset issue type and fields when project changes
                      setSelectedIssueType("");
                      setFields([]);
                    }}
                    disabled={projectsLoading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("issues.selectProject")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.key}>
                          {project.name} {`(${project.key})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}

              {/* Issue Type Selector */}
              {issueTypes.length > 0 && (
                <FormItem>
                  <FormLabel className="inline-flex items-center gap-0.5">
                    {t("issues.issueType")}
                    <sup>
                      <Asterisk className="w-3 h-3 text-destructive" />
                    </sup>
                  </FormLabel>
                  <Select
                    value={selectedIssueType}
                    onValueChange={setSelectedIssueType}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t("issues.selectIssueType")}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {issueTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}

              {/* Dynamic Fields */}
              {fields.map((field) => (
                <DynamicJiraField
                  key={field.key}
                  field={field}
                  form={form}
                  integrationId={integrationId}
                  projectKey={selectedProjectKey}
                />
              ))}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isLoading}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  disabled={isLoading}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void form.handleSubmit(onSubmit)();
                  }}
                >
                  {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t("common.actions.create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
